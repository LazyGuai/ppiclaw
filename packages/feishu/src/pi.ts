import { existsSync, readdirSync } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type {
	AgentExecutor,
	AgentRunResult,
	ChannelContext,
	IncomingMessage,
	ReplyHandle,
} from "@mariozechner/pi-channel-core";
import {
	type AgentSession,
	type CreateAgentSessionOptions,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import {
	buildFileSentMessage,
	buildNoTextRecoveryPrompt,
	extractAssistantTextFromMessage,
	extractSendableOutput,
	parseDirectSendFileCommand,
	type SendFileDirective,
} from "./assistant-output.js";
import type { FeishuBehaviorSettings } from "./config.js";
import { createStreamUpdater, type StreamUpdater } from "./stream-updater.js";
import { startWorkingPulse, type WorkingPulseController } from "./working-pulse.js";

interface ManagedSession {
	generation: number;
	initWarning?: string;
	sessionFile: string;
	session: AgentSession;
}

export interface PiFeishuExecutorOptions {
	agentCwd: string;
	agentDir?: string;
	behavior: FeishuBehaviorSettings;
	sessionRootDir: string;
}

export class PiFeishuExecutor implements AgentExecutor {
	private readonly activeSessions = new Set<AgentSession>();
	private readonly sessionGenerations = new Map<string, number>();
	private readonly sessions = new Map<string, ManagedSession>();

	constructor(private readonly options: PiFeishuExecutorOptions) {}

	async run(context: ChannelContext): Promise<AgentRunResult> {
		let managed: ManagedSession | undefined;
		let unsubscribe: (() => void) | undefined;
		let workingPulse: WorkingPulseController | undefined;
		let streamUpdate: StreamUpdater | undefined;
		const conversationDir =
			context.conversationDir ??
			join(this.options.sessionRootDir, sanitizeConversationKey(context.message.conversationKey));
		const uploadRoots = buildUploadRoots(conversationDir, this.options.agentCwd, this.options.sessionRootDir);

		try {
			const directFileCommand = parseDirectSendFileCommand(context.message.text);
			if (directFileCommand) {
				const sendResult = await sendFiles(context.reply, [directFileCommand], uploadRoots);
				if (sendResult.sent === 0) {
					throw new Error("file not found or blocked for send.");
				}
				await context.reply.reply(buildFileSentMessage(sendResult.sent));
				return { stopReason: "stop" };
			}

			workingPulse = startWorkingPulse(context.reply, {
				earlyRefreshScheduleMs: this.options.behavior.workingEarlyRefreshScheduleMs,
				initialWaitMs: this.options.behavior.workingInitialWaitMs,
				minVisibleMs: this.options.behavior.minWorkingVisibleMs,
				pulseIntervalMs: this.options.behavior.workingPulseIntervalMs,
				sendCancel: this.options.behavior.sendWorkingCancel,
			});
			await workingPulse.awaitInitialSend();
			managed = await this.getOrCreateSession(context.message.conversationKey, conversationDir);
			managed = await this.rotateSessionIfNeeded(context.message.conversationKey, conversationDir, managed);

			this.activeSessions.add(managed.session);

			if (managed.initWarning && !managed.session.model) {
				throw new Error(managed.initWarning);
			}

			if (this.options.behavior.streamEnabled) {
				streamUpdate = createStreamUpdater(context.reply, {
					forceSendChars: this.options.behavior.streamForceSendChars,
					maxUpdates: this.options.behavior.streamMaxUpdates,
					minDelayMs: this.options.behavior.streamMinDelayMs,
					minIntervalMs: this.options.behavior.streamMinIntervalMs,
					minNewChars: this.options.behavior.streamMinNewChars,
					preferNaturalBoundary: this.options.behavior.streamPreferNaturalBoundary,
				});
				const sessionWithStream = managed.session as unknown as {
					agent?: {
						subscribe?: (listener: (event: unknown) => void) => () => void;
					};
					subscribe?: (listener: (event: unknown) => void) => () => void;
				};
				const onStreamEvent = (event: unknown): void => {
					if (!event || typeof event !== "object") {
						return;
					}
					const maybeMessageUpdate = event as {
						message?: unknown;
						type?: string;
					};
					if (maybeMessageUpdate.type !== "message_update") {
						return;
					}
					const partialText = extractAssistantTextFromMessage(maybeMessageUpdate.message);
					if (!partialText) {
						return;
					}
					streamUpdate?.push(partialText);
				};
				if (typeof sessionWithStream.subscribe === "function") {
					unsubscribe = sessionWithStream.subscribe(onStreamEvent);
				} else if (typeof sessionWithStream.agent?.subscribe === "function") {
					unsubscribe = sessionWithStream.agent.subscribe(onStreamEvent);
				}
			}

			const promptStartedAt = Date.now();
			const firstRunStartIndex = managed.session.messages.length;
			await managed.session.prompt(buildPrompt(context.message));
			const promptElapsed = Date.now() - promptStartedAt;
			console.log(
				`[feishu] model completed in ${promptElapsed}ms (conversation=${context.message.conversationKey})`,
			);
			await streamUpdate?.flush();

			let output = extractSendableOutput(managed.session, firstRunStartIndex);
			if (!output.text && output.files.length === 0) {
				console.warn(
					`[feishu] no sendable text in first response, retrying once (conversation=${context.message.conversationKey})`,
				);
				const retryStartIndex = managed.session.messages.length;
				await managed.session.prompt(buildNoTextRecoveryPrompt(context.message));
				output = extractSendableOutput(managed.session, retryStartIndex);
			}

			if (!output.text && output.files.length === 0) {
				await context.reply.reply(
					"I did not receive a complete response this time. Please send the same question again.",
				);
				return { stopReason: "stop" };
			}

			if (output.text) {
				const sendStartedAt = Date.now();
				await sendFinalReply(context.reply, output.text);
				console.log(
					`[feishu] final text sent in ${Date.now() - sendStartedAt}ms (conversation=${context.message.conversationKey})`,
				);
			}

			const sendResult = await sendFiles(context.reply, output.files, uploadRoots);
			if (!output.text && sendResult.sent === 0) {
				throw new Error("pi did not return a sendable text response.");
			}
			if (!output.text && sendResult.sent > 0) {
				await context.reply.reply(buildFileSentMessage(sendResult.sent));
			}
			if (output.text && output.files.length > 0 && sendResult.sent === 0) {
				await context.reply.reply(
					"[feishu] 文件发送失败：路径不存在、无权限，或为历史失效路径。请让我重新检索当前文件后再发送。",
				);
			}
			return { stopReason: "stop" };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			await context.reply.reply(`[feishu] ${errorMessage}`);
			return {
				stopReason: "error",
				errorMessage,
			};
		} finally {
			unsubscribe?.();
			if (managed) {
				this.activeSessions.delete(managed.session);
			}
			if (workingPulse) {
				await workingPulse.stop();
			}
		}
	}

	async abort(): Promise<void> {
		await Promise.all(Array.from(this.activeSessions, async (session) => session.abort()));
	}

	private async getOrCreateSession(conversationKey: string, conversationDir: string): Promise<ManagedSession> {
		const existing = this.sessions.get(conversationKey);
		if (existing) {
			return existing;
		}

		const generation = this.sessionGenerations.get(conversationKey) ?? 0;
		const managed = await this.createManagedSession(conversationDir, generation);
		this.sessions.set(conversationKey, managed);
		return managed;
	}

	private async rotateSessionIfNeeded(
		conversationKey: string,
		conversationDir: string,
		managed: ManagedSession,
	): Promise<ManagedSession> {
		if (managed.session.messages.length <= this.options.behavior.maxSessionMessages) {
			return managed;
		}

		const nextGeneration = managed.generation + 1;
		console.log(
			`[feishu] rotating long session ${conversationKey} at ${managed.session.messages.length} messages -> generation ${nextGeneration}`,
		);
		this.sessions.delete(conversationKey);
		this.sessionGenerations.set(conversationKey, nextGeneration);
		await managed.session.abort().catch(() => undefined);

		const rotated = await this.createManagedSession(conversationDir, nextGeneration);
		this.sessions.set(conversationKey, rotated);
		return rotated;
	}

	private async createManagedSession(conversationDir: string, generation: number): Promise<ManagedSession> {
		await mkdir(conversationDir, { recursive: true });
		const agentDir = this.options.agentDir ?? getAgentDir();
		const channelSkillPaths = resolveChannelSkillPaths(this.options.agentCwd, "feishu");
		const resourceLoader =
			channelSkillPaths.length > 0
				? new DefaultResourceLoader({
						additionalSkillPaths: channelSkillPaths,
						agentDir,
						cwd: this.options.agentCwd,
					})
				: undefined;
		await resourceLoader?.reload();

		const sessionFile = getSessionFilePath(conversationDir, generation);
		const sessionManager = SessionManager.open(sessionFile, conversationDir, this.options.agentCwd);
		const createOptions: CreateAgentSessionOptions = {
			agentDir,
			cwd: this.options.agentCwd,
			resourceLoader,
			sessionManager,
		};
		const { session, modelFallbackMessage } = await createAgentSession(createOptions);

		return {
			generation,
			initWarning: modelFallbackMessage,
			session,
			sessionFile,
		};
	}
}

function getSessionFilePath(conversationDir: string, generation: number): string {
	if (generation <= 0) {
		return join(conversationDir, "session.jsonl");
	}
	return join(conversationDir, `session.${generation}.jsonl`);
}

function resolveChannelSkillPaths(agentCwd: string, channelName: string): string[] {
	const candidates = [
		resolve(agentCwd, "packages", channelName, "skills"),
		resolve(process.cwd(), "packages", channelName, "skills"),
	];
	return Array.from(new Set(candidates.filter(hasSkillDirectories)));
}

function hasSkillDirectories(dir: string): boolean {
	if (!existsSync(dir)) {
		return false;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		return entries.some((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md")));
	} catch {
		return false;
	}
}

function buildPrompt(message: IncomingMessage): string {
	const parts = [
		`[platform] ${message.platform}`,
		`[conversation] ${message.conversationKey}`,
		`[sender_id] ${message.senderId}`,
		`[sender_name] ${message.senderName ?? "unknown"}`,
		`[mode] ${message.isDirect ? "direct" : "group"}`,
		`[mentioned] ${message.isMentioned ? "true" : "false"}`,
		"",
		"User message:",
		message.text || "(empty message)",
	];

	if (message.attachments.length > 0) {
		const attachmentLines = message.attachments.map((attachment) => {
			const segments = [
				attachment.name ?? attachment.id ?? "attachment",
				attachment.mimeType ? `type=${attachment.mimeType}` : undefined,
				typeof attachment.sizeBytes === "number" ? `size=${attachment.sizeBytes}` : undefined,
				attachment.localPath ? `local=${attachment.localPath}` : undefined,
				attachment.platformUrl ? `url=${attachment.platformUrl}` : undefined,
			].filter(Boolean);
			return segments.length > 0 ? segments.join(" ") : "attachment";
		});
		parts.push("", "Attachments:", ...attachmentLines);
	}

	parts.push(
		"",
		"[internal protocol, do not explain to user]",
		"When tasks involve Feishu docs/wiki/drive/permissions, prefer skills feishu-doc, feishu-wiki, feishu-drive, feishu-perm.",
		"When replying with Markdown, do not wrap the entire response in a single ```md or ```markdown fenced block.",
		"Use fenced code blocks only for real code snippets, not for the full answer body.",
		"Only output <send_file ... /> when you have already verified the file currently exists.",
		"If a file path might be stale or missing, do not claim it was sent.",
		"When you must send an existing local file, append one directive line at the very end:",
		'<send_file path="relative/or/absolute/path" title="optional filename" />',
		"If no file sending is needed, do not output this tag.",
	);

	return parts.join("\n");
}

async function sendFinalReply(reply: ReplyHandle, text: string): Promise<void> {
	await reply.reply(text);
}

interface FileSendResult {
	failed: number;
	sent: number;
}

function sanitizeConversationKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function sendFiles(reply: ReplyHandle, files: SendFileDirective[], roots: string[]): Promise<FileSendResult> {
	if (!files.length || !reply.uploadFile) {
		return { failed: files.length, sent: 0 };
	}

	let sent = 0;
	let failed = 0;
	for (const file of files) {
		const resolvedPath = await resolveUploadPath(file.path, roots);
		if (!resolvedPath) {
			console.warn(`[feishu] file not found or blocked: ${file.path}`);
			failed += 1;
			continue;
		}

		try {
			await reply.uploadFile(resolvedPath, file.title);
			sent += 1;
		} catch (error) {
			console.warn(`[feishu] file send failed: ${error instanceof Error ? error.message : String(error)}`);
			failed += 1;
		}
	}

	return { failed, sent };
}

async function resolveUploadPath(rawPath: string, roots: string[]): Promise<string | undefined> {
	const candidates = new Set<string>();
	if (isAbsolute(rawPath)) {
		candidates.add(resolve(rawPath));
	} else {
		for (const root of roots) {
			if (!root) {
				continue;
			}
			candidates.add(resolve(root, rawPath));
		}
	}

	for (const candidate of candidates) {
		if (!(await isSafeUploadPath(candidate, roots))) {
			continue;
		}
		try {
			await access(candidate);
			const info = await stat(candidate);
			if (info.isFile()) {
				return candidate;
			}
		} catch {}
	}

	return undefined;
}

async function isSafeUploadPath(targetPath: string, roots: string[]): Promise<boolean> {
	const resolvedTarget = resolve(targetPath);
	for (const root of roots) {
		if (!root) {
			continue;
		}
		const resolvedRoot = resolve(root);
		if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
			return true;
		}
	}
	return false;
}

function buildUploadRoots(conversationDir: string, agentCwd: string, sessionRootDir: string): string[] {
	const userHome = homedir();
	const userProfile = process.env.USERPROFILE;
	const desktopDir = join(userProfile ?? userHome, "Desktop");
	const downloadsDir = join(userProfile ?? userHome, "Downloads");
	const documentsDir = join(userProfile ?? userHome, "Documents");

	return Array.from(
		new Set(
			[
				conversationDir,
				agentCwd,
				sessionRootDir,
				process.cwd(),
				tmpdir(),
				userHome,
				userProfile,
				desktopDir,
				downloadsDir,
				documentsDir,
			]
				.filter((value): value is string => Boolean(value))
				.map((value) => resolve(value)),
		),
	);
}
