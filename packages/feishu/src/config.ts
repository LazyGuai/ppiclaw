import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type FeishuChannelConfig, readChannelsConfig } from "@mariozechner/pi-channel-core";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { FeishuTransport } from "./types.js";

export interface FeishuBehaviorSettings {
	maxSessionMessages: number;
	minWorkingVisibleMs: number;
	sendWorkingCancel: boolean;
	streamEnabled: boolean;
	streamForceSendChars: number;
	streamMaxUpdates: number;
	streamMinDelayMs: number;
	streamMinIntervalMs: number;
	streamMinNewChars: number;
	streamPreferNaturalBoundary: boolean;
	streamThinkingText: string;
	streamTypingReaction: string;
	workingEarlyRefreshScheduleMs: number[];
	workingInitialWaitMs: number;
	workingPulseIntervalMs: number;
}

export interface FeishuBotConfig {
	agentCwd: string;
	agentDir: string;
	apiBaseUrl: string;
	appId?: string;
	appSecret?: string;
	behavior: FeishuBehaviorSettings;
	botOpenId?: string;
	encryptKey?: string;
	requireMention: boolean;
	transport: FeishuTransport;
	verifyToken?: string;
	webhookHost: string;
	webhookPath: string;
	webhookPort: number;
	workingDir: string;
}

export interface ParsedCliArgs {
	agentCwd?: string;
	agentDir?: string;
	help: boolean;
	transport?: FeishuTransport;
	workingDir?: string;
	host?: string;
	path?: string;
	port?: number;
}

export function parseArgs(argv: string[]): ParsedCliArgs {
	const parsed: ParsedCliArgs = {
		help: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === "--help" || arg === "-h") {
			parsed.help = true;
		} else if (arg.startsWith("--agent-cwd=")) {
			parsed.agentCwd = arg.slice("--agent-cwd=".length);
		} else if (arg === "--agent-cwd") {
			parsed.agentCwd = argv[++i];
		} else if (arg.startsWith("--agent-dir=")) {
			parsed.agentDir = arg.slice("--agent-dir=".length);
		} else if (arg === "--agent-dir") {
			parsed.agentDir = argv[++i];
		} else if (arg.startsWith("--transport=")) {
			parsed.transport = parseTransport(arg.slice("--transport=".length));
		} else if (arg === "--transport") {
			parsed.transport = parseTransport(argv[++i] || "");
		} else if (arg.startsWith("--host=")) {
			parsed.host = arg.slice("--host=".length);
		} else if (arg === "--host") {
			parsed.host = argv[++i];
		} else if (arg.startsWith("--port=")) {
			parsed.port = Number.parseInt(arg.slice("--port=".length), 10);
		} else if (arg === "--port") {
			parsed.port = Number.parseInt(argv[++i] || "", 10);
		} else if (arg.startsWith("--path=")) {
			parsed.path = arg.slice("--path=".length);
		} else if (arg === "--path") {
			parsed.path = argv[++i];
		} else if (!arg.startsWith("-")) {
			parsed.workingDir = arg;
		}
	}

	return parsed;
}

export function readConfig(args: ParsedCliArgs, env: NodeJS.ProcessEnv): FeishuBotConfig {
	const agentDir = args.agentDir ?? env.PI_AGENT_DIR ?? getAgentDir();
	const channelConfig = readFeishuChannelConfig(agentDir);
	const defaultWorkingDir = resolve(process.cwd(), "packages", "feishu", "data-feishu");
	const rawRequireMention =
		(channelConfig as unknown as Record<string, unknown>).requireMention ?? env.FEISHU_BOT_REQUIRE_MENTION;
	const behavior = readBehaviorSettings(env);

	return {
		agentCwd: args.agentCwd ?? channelConfig.agentCwd ?? env.FEISHU_BOT_AGENT_CWD ?? process.cwd(),
		agentDir,
		apiBaseUrl: channelConfig.apiBaseUrl ?? env.FEISHU_BOT_API_BASE_URL ?? "https://open.feishu.cn",
		appId: channelConfig.appId ?? env.FEISHU_BOT_APP_ID,
		appSecret: channelConfig.appSecret ?? env.FEISHU_BOT_APP_SECRET,
		behavior,
		botOpenId: channelConfig.botOpenId ?? env.FEISHU_BOT_OPEN_ID,
		encryptKey: channelConfig.encryptKey ?? env.FEISHU_BOT_ENCRYPT_KEY,
		requireMention: parseBoolean(rawRequireMention, true),
		transport:
			args.transport ?? parseTransport(channelConfig.transport ?? env.FEISHU_BOT_TRANSPORT ?? "long-connection"),
		verifyToken: channelConfig.verifyToken ?? env.FEISHU_BOT_VERIFY_TOKEN ?? env.FEISHU_BOT_VERIFICATION_TOKEN,
		webhookHost:
			args.host ??
			((channelConfig as unknown as Record<string, unknown>).webhookHost as string | undefined) ??
			env.FEISHU_BOT_WEBHOOK_HOST ??
			"127.0.0.1",
		webhookPath: args.path ?? channelConfig.webhookPath ?? env.FEISHU_BOT_WEBHOOK_PATH ?? "/feishu/events",
		webhookPort: args.port ?? channelConfig.webhookPort ?? parsePort(env.FEISHU_BOT_WEBHOOK_PORT, 3000),
		workingDir: args.workingDir ?? channelConfig.workingDir ?? defaultWorkingDir,
	};
}

function parseTransport(value: string): FeishuTransport {
	const normalized = value.trim().toLowerCase();
	if (normalized === "callback" || normalized === "webhook") {
		return "callback";
	}
	if (normalized === "long-connection" || normalized === "long_connection" || normalized === "websocket") {
		return "long-connection";
	}
	throw new Error(`Unsupported Feishu transport: ${value}`);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
	return fallback;
}

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const port = Number.parseInt(value, 10);
	if (!Number.isFinite(port) || port <= 0) {
		return fallback;
	}
	return port;
}

function readFeishuChannelConfig(agentDir: string): FeishuChannelConfig {
	return readChannelsConfig(agentDir).feishu ?? {};
}

interface FeishuBehaviorOverrides {
	maxSessionMessages?: unknown;
	minWorkingVisibleMs?: unknown;
	sendWorkingCancel?: unknown;
	streamEnabled?: unknown;
	streamForceSendChars?: unknown;
	streamMaxUpdates?: unknown;
	streamMinDelayMs?: unknown;
	streamMinIntervalMs?: unknown;
	streamMinNewChars?: unknown;
	streamPreferNaturalBoundary?: unknown;
	streamThinkingText?: unknown;
	streamTypingReaction?: unknown;
	workingEarlyRefreshScheduleMs?: unknown;
	workingInitialWaitMs?: unknown;
	workingPulseIntervalMs?: unknown;
}

function readBehaviorSettings(env: NodeJS.ProcessEnv): FeishuBehaviorSettings {
	const fileOverrides = loadBehaviorOverridesFromFile();

	return {
		maxSessionMessages: parsePositiveInt(env.FEISHU_MAX_SESSION_MESSAGES ?? fileOverrides.maxSessionMessages, 120),
		minWorkingVisibleMs: parsePositiveInt(
			env.FEISHU_MIN_WORKING_VISIBLE_MS ?? fileOverrides.minWorkingVisibleMs,
			1200,
		),
		sendWorkingCancel: parseBoolean(env.FEISHU_SEND_WORKING_CANCEL ?? fileOverrides.sendWorkingCancel, true),
		streamEnabled: parseBoolean(env.FEISHU_STREAM_ENABLED ?? fileOverrides.streamEnabled, true),
		streamForceSendChars: parsePositiveInt(
			env.FEISHU_STREAM_FORCE_SEND_CHARS ?? fileOverrides.streamForceSendChars,
			260,
		),
		streamMaxUpdates: parsePositiveInt(env.FEISHU_STREAM_MAX_UPDATES ?? fileOverrides.streamMaxUpdates, 18),
		streamMinDelayMs: parsePositiveInt(env.FEISHU_STREAM_MIN_DELAY_MS ?? fileOverrides.streamMinDelayMs, 700),
		streamMinIntervalMs: parsePositiveInt(
			env.FEISHU_STREAM_MIN_INTERVAL_MS ?? fileOverrides.streamMinIntervalMs,
			2400,
		),
		streamMinNewChars: parsePositiveInt(env.FEISHU_STREAM_MIN_NEW_CHARS ?? fileOverrides.streamMinNewChars, 90),
		streamPreferNaturalBoundary: parseBoolean(
			env.FEISHU_STREAM_PREFER_NATURAL_BOUNDARY ?? fileOverrides.streamPreferNaturalBoundary,
			true,
		),
		streamThinkingText: parseString(
			env.FEISHU_STREAM_THINKING_TEXT,
			fileOverrides.streamThinkingText,
			"\uD83E\uDD14 \u601D\u8003\u4E2D...",
		),
		streamTypingReaction: parseString(
			env.FEISHU_STREAM_TYPING_REACTION,
			fileOverrides.streamTypingReaction,
			"Typing",
		),
		workingEarlyRefreshScheduleMs: parsePositiveIntList(
			env.FEISHU_WORKING_EARLY_REFRESH_SCHEDULE_MS ?? fileOverrides.workingEarlyRefreshScheduleMs,
			[],
		),
		workingInitialWaitMs: parsePositiveInt(
			env.FEISHU_WORKING_INITIAL_WAIT_MS ?? fileOverrides.workingInitialWaitMs,
			350,
		),
		workingPulseIntervalMs: parsePositiveInt(
			env.FEISHU_WORKING_PULSE_INTERVAL_MS ?? fileOverrides.workingPulseIntervalMs,
			50_000,
		),
	};
}

function loadBehaviorOverridesFromFile(): FeishuBehaviorOverrides {
	for (const path of getBehaviorConfigPaths()) {
		if (!existsSync(path)) {
			continue;
		}

		try {
			const raw = readFileSync(path, "utf-8");
			const parsed = parseBehaviorJson(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("root must be an object");
			}
			return parsed as FeishuBehaviorOverrides;
		} catch (error) {
			console.warn(
				`[feishu] failed to parse behavior config at ${path}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return {};
		}
	}

	return {};
}

function getBehaviorConfigPaths(): string[] {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	return [resolve(moduleDir, "..", "behavior.jsonc"), resolve(moduleDir, "..", "behavior.json")];
}

function parseString(primary: string | undefined, fallback: unknown, defaultValue: string): string {
	if (typeof primary === "string" && primary.trim()) {
		return primary.trim();
	}
	if (typeof fallback === "string" && fallback.trim()) {
		return fallback.trim();
	}
	return defaultValue;
}

function parsePositiveInt(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return fallback;
}

function parsePositiveIntList(value: unknown, fallback: number[]): number[] {
	if (Array.isArray(value)) {
		const parsed = value
			.map((item) => (typeof item === "number" ? item : typeof item === "string" ? Number.parseInt(item, 10) : NaN))
			.filter((item) => Number.isFinite(item) && item > 0)
			.map((item) => Math.floor(item));
		return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = value
			.split(",")
			.map((item) => Number.parseInt(item.trim(), 10))
			.filter((item) => Number.isFinite(item) && item > 0);
		return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
	}
	return fallback;
}

function parseBehaviorJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		const sanitized = stripJsonComments(raw);
		return JSON.parse(sanitized);
	}
}

function stripJsonComments(input: string): string {
	let output = "";
	let inString = false;
	let escaping = false;

	for (let i = 0; i < input.length; i += 1) {
		const char = input[i] ?? "";
		const next = input[i + 1] ?? "";

		if (inString) {
			output += char;
			if (escaping) {
				escaping = false;
				continue;
			}
			if (char === "\\") {
				escaping = true;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			output += char;
			continue;
		}

		if (char === "/" && next === "/") {
			i += 2;
			while (i < input.length) {
				const c = input[i] ?? "";
				if (c === "\n") {
					output += "\n";
					break;
				}
				if (c === "\r") {
					output += "\r";
					if ((input[i + 1] ?? "") === "\n") {
						output += "\n";
						i += 1;
					}
					break;
				}
				i += 1;
			}
			continue;
		}

		if (char === "/" && next === "*") {
			i += 2;
			while (i < input.length) {
				const c = input[i] ?? "";
				if (c === "\n") {
					output += "\n";
				} else if (c === "\r") {
					output += "\r";
					if ((input[i + 1] ?? "") === "\n") {
						output += "\n";
						i += 1;
					}
				}
				if (c === "*" && (input[i + 1] ?? "") === "/") {
					i += 1;
					break;
				}
				i += 1;
			}
			continue;
		}

		output += char;
	}

	return output;
}
