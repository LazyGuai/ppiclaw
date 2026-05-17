import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoggedMessage } from "./types.js";

function ensureDir(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

function safeSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class ChannelStore {
	constructor(private readonly workingDir: string) {
		ensureDir(workingDir);
	}

	getConversationDir(conversationKey: string): string {
		const dir = join(this.workingDir, safeSegment(conversationKey));
		ensureDir(dir);
		return dir;
	}

	getAttachmentsDir(conversationKey: string): string {
		const dir = join(this.getConversationDir(conversationKey), "attachments");
		ensureDir(dir);
		return dir;
	}

	getLogPath(conversationKey: string): string {
		return join(this.getConversationDir(conversationKey), "log.jsonl");
	}

	async logMessage(message: LoggedMessage): Promise<void> {
		const line = `${JSON.stringify(message)}\n`;
		await appendFile(this.getLogPath(message.conversationKey), line, "utf-8");
	}
}
