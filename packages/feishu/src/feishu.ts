import {
	ChannelAgentRunner,
	ChannelStore,
	ConversationQueue,
	type IncomingMessage,
	type ReplyHandle,
} from "@mariozechner/pi-channel-core";
import type { FeishuBotConfig } from "./config.js";
import { mapFeishuEventToIncomingMessage } from "./mapping.js";
import { FeishuOpenApiClient } from "./openapi.js";
import { PiFeishuExecutor } from "./pi.js";
import type { FeishuMessageEvent } from "./types.js";

export class FeishuBotApp {
	private readonly openApiClient: FeishuOpenApiClient;
	private readonly runner: ChannelAgentRunner;
	private readonly store: ChannelStore;
	private readonly queues = new Map<string, ConversationQueue>();
	private readonly processedMessageKeys = new Map<string, number>();
	private readonly processedMessageTtlMs = 10 * 60 * 1000;
	private readonly processedMessageMax = 5000;

	constructor(private readonly config: FeishuBotConfig) {
		this.openApiClient = new FeishuOpenApiClient(config);
		this.store = new ChannelStore(config.workingDir);
		this.runner = new ChannelAgentRunner(
			new PiFeishuExecutor({
				agentCwd: config.agentCwd,
				agentDir: config.agentDir,
				behavior: config.behavior,
				sessionRootDir: config.workingDir,
			}),
		);
	}

	async warmUp(): Promise<void> {
		await this.openApiClient.warmUp();
	}

	async handleEvent(event: FeishuMessageEvent): Promise<void> {
		try {
			const incoming = mapFeishuEventToIncomingMessage(event, {
				botOpenId: this.config.botOpenId,
			});
			if (!incoming.isDirect && this.config.requireMention && !incoming.isMentioned) {
				return;
			}

			const messageKey = `${incoming.conversationKey}:${incoming.messageId}`;
			if (this.markIfDuplicate(messageKey)) {
				console.log(`[feishu] duplicate message ignored: ${messageKey}`);
				return;
			}

			await this.store.logMessage({
				date: new Date().toISOString(),
				messageId: incoming.messageId,
				platform: incoming.platform,
				conversationKey: incoming.conversationKey,
				senderId: incoming.senderId,
				senderName: incoming.senderName,
				text: incoming.text,
				attachments: incoming.attachments,
			});

			const reply = createReplyHandle(event, incoming, this.openApiClient);
			const queue = this.getQueue(incoming.conversationKey);
			queue.enqueue({
				label: `${incoming.conversationKey}:${incoming.messageId}`,
				run: async () => {
					try {
						await this.handleIncomingMessage(incoming, reply);
					} catch (error) {
						console.error(
							`[feishu] unhandled message error (conversation=${incoming.conversationKey}, message=${incoming.messageId}): ${
								error instanceof Error ? error.message : String(error)
							}`,
						);
						await safeReply(reply, "System is busy. Please try again shortly.");
					}
				},
			});
		} catch (error) {
			console.error(`[feishu] failed to handle event: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async handleIncomingMessage(message: IncomingMessage, reply: ReplyHandle): Promise<void> {
		await this.runner.run({
			conversationDir: this.store.getConversationDir(message.conversationKey),
			message,
			reply,
		});
	}

	private getQueue(conversationKey: string): ConversationQueue {
		let queue = this.queues.get(conversationKey);
		if (!queue) {
			queue = new ConversationQueue();
			this.queues.set(conversationKey, queue);
		}
		return queue;
	}

	private markIfDuplicate(messageKey: string): boolean {
		const now = Date.now();
		this.pruneProcessedMessages(now);
		if (this.processedMessageKeys.has(messageKey)) {
			return true;
		}

		this.processedMessageKeys.set(messageKey, now);
		if (this.processedMessageKeys.size > this.processedMessageMax) {
			const oldestKey = this.processedMessageKeys.keys().next().value;
			if (oldestKey) {
				this.processedMessageKeys.delete(oldestKey);
			}
		}
		return false;
	}

	private pruneProcessedMessages(now: number): void {
		for (const [messageKey, timestamp] of this.processedMessageKeys) {
			if (now - timestamp <= this.processedMessageTtlMs) {
				break;
			}
			this.processedMessageKeys.delete(messageKey);
		}
	}
}

function createReplyHandle(
	event: FeishuMessageEvent,
	message: IncomingMessage,
	openApiClient: FeishuOpenApiClient,
): ReplyHandle {
	if (openApiClient.isConfigured()) {
		const streamState = {
			lastSentText: "",
		};
		return {
			async reply(text: string): Promise<void> {
				streamState.lastSentText = "";
				await openApiClient.replyText(event, text, message.text, { mode: "final" });
			},
			async replace(text: string): Promise<void> {
				const normalized = normalizeStreamText(text);
				if (!normalized || normalized === streamState.lastSentText) {
					return;
				}

				await openApiClient.replyText(event, normalized, undefined, { mode: "stream" });
				streamState.lastSentText = normalized;
			},
			async uploadFile(path: string, title?: string): Promise<void> {
				await openApiClient.uploadFile(event, path, title);
			},
			async setWorking(working: boolean): Promise<void> {
				await openApiClient.setWorking(event, working);
			},
		};
	}

	return {
		async reply(text: string): Promise<void> {
			console.log(`[reply][${message.conversationKey}] ${text}`);
		},
		async replace(text: string): Promise<void> {
			console.log(`[replace][${message.conversationKey}] ${text}`);
		},
		async setWorking(working: boolean): Promise<void> {
			console.log(`[working][${message.conversationKey}] ${working ? "true" : "false"}`);
		},
		async uploadFile(path: string, title?: string): Promise<void> {
			console.log(`[upload][${message.conversationKey}] ${title ?? path}`);
		},
	};
}

function normalizeStreamText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function safeReply(reply: ReplyHandle, text: string): Promise<void> {
	try {
		await reply.reply(text);
	} catch (error) {
		console.error(
			`[feishu] failed to send fallback reply: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
