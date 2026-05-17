import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface QqChannelConfig {
	agentCwd?: string;
	apiBaseUrl?: string;
	appId?: string;
	appSecret?: string;
	botToken?: string;
	publicKey?: string;
	tokenUrl?: string;
	transport?: "webhook" | "websocket";
	webhookPath?: string;
	webhookPort?: number;
	workingDir?: string;
}

export interface FeishuChannelConfig {
	agentCwd?: string;
	apiBaseUrl?: string;
	appId?: string;
	appSecret?: string;
	botOpenId?: string;
	encryptKey?: string;
	tokenUrl?: string;
	transport?: "callback" | "long-connection";
	verifyToken?: string;
	webhookPath?: string;
	webhookPort?: number;
	workingDir?: string;
}

export interface ChannelsConfigFile {
	qqbot?: QqChannelConfig;
	feishu?: FeishuChannelConfig;
}

export function getChannelsPath(agentDir: string): string {
	return join(agentDir, "channels.json");
}

export function readChannelsConfig(agentDir: string): ChannelsConfigFile {
	const path = getChannelsPath(agentDir);
	if (!existsSync(path)) {
		return {};
	}

	const raw = readFileSync(path, "utf-8");
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid channels.json at ${path}: root must be an object.`);
	}

	return parsed as ChannelsConfigFile;
}
