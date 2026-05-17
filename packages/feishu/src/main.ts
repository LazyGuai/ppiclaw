#!/usr/bin/env node

import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createEventDispatcher } from "./client.js";
import { parseArgs, readConfig } from "./config.js";
import { FeishuBotApp } from "./feishu.js";
import { FeishuCallbackTransport } from "./transport/callback.js";
import { FeishuLongConnectionTransport } from "./transport/long-connection.js";

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const config = readConfig(args, process.env);
	await ensureSingleInstance(config.workingDir);
	const app = new FeishuBotApp(config);
	await app.warmUp();

	const eventDispatcher = createEventDispatcher(config, {
		onMessage: async (event) => {
			await app.handleEvent(event);
		},
	});

	if (config.transport === "callback") {
		const transport = new FeishuCallbackTransport({
			eventDispatcher,
			host: config.webhookHost,
			path: config.webhookPath,
			port: config.webhookPort,
		});
		await transport.start();
		console.log(
			`[feishu] callback transport listening on http://${config.webhookHost}:${config.webhookPort}${config.webhookPath}`,
		);
		return;
	}

	const transport = new FeishuLongConnectionTransport({
		config,
		eventDispatcher,
	});
	await transport.start();
	console.log("[feishu] long-connection transport connected");
}

async function ensureSingleInstance(workingDir: string): Promise<void> {
	const lockDir = resolve(workingDir);
	await mkdir(lockDir, { recursive: true });
	const lockPath = join(lockDir, "feishu.lock");

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const file = await open(lockPath, "wx");
			await file.writeFile(String(process.pid), "utf8");
			await file.close();
			return;
		} catch (error) {
			if (!isAlreadyExistsError(error)) {
				throw error;
			}

			if (attempt === 0 && (await isStaleLock(lockPath))) {
				await safeUnlink(lockPath);
				continue;
			}

			throw new Error(`Another feishu process is already running (lock: ${lockPath})`);
		}
	}
}

async function isStaleLock(lockPath: string): Promise<boolean> {
	try {
		const text = (await readFile(lockPath, "utf8")).trim();
		const pid = Number.parseInt(text, 10);
		if (!Number.isFinite(pid) || pid <= 0) {
			return true;
		}

		try {
			process.kill(pid, 0);
			return false;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			return code === "ESRCH";
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function safeUnlink(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			throw error;
		}
	}
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
	return Boolean(
		error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST",
	);
}

function printHelp(): void {
	console.log(`feishu - Feishu/Lark adapter for pi

Usage:
  feishu [options] [working-directory]

Options:
  --agent-cwd <path>                 Workspace for pi agent execution (default: current directory)
  --agent-dir <path>                 pi agent config directory (default: ~/.pi/agent)
  [working-directory]                Runtime data directory (default: ./packages/feishu/data-feishu)
  --transport <callback|long-connection>  Transport mode (default: long-connection)
  --host <host>                      Callback bind host (default: 127.0.0.1)
  --port <number>                    Callback bind port (default: 3000)
  --path <path>                      Callback path (default: /feishu/events)
  --help, -h                         Show help

Environment Variables:
  FEISHU_BOT_AGENT_CWD
  FEISHU_BOT_API_BASE_URL
  FEISHU_BOT_APP_ID
  FEISHU_BOT_APP_SECRET
  FEISHU_BOT_ENCRYPT_KEY
  FEISHU_BOT_OPEN_ID
  FEISHU_BOT_REQUIRE_MENTION
  FEISHU_BOT_TRANSPORT
  FEISHU_BOT_VERIFY_TOKEN
  FEISHU_BOT_WEBHOOK_HOST
  FEISHU_BOT_WEBHOOK_PATH
  FEISHU_BOT_WEBHOOK_PORT
  PI_AGENT_DIR

JSON Configuration:
  ~/.pi/agent/channels.json -> feishu

Behavior Configuration:
  packages/feishu/behavior.jsonc   (preferred, supports comments)
  packages/feishu/behavior.json    (fallback)
`);
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[feishu] ${message}`);
	process.exitCode = 1;
});
