import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuBotConfig } from "./config.js";
import type { FeishuMessageEvent } from "./types.js";
import { unwrapFeishuMessageEvent } from "./types.js";

export interface FeishuEventDispatcherOptions {
	onMessage: (event: FeishuMessageEvent) => Promise<void>;
}

export function createFeishuClient(config: Pick<FeishuBotConfig, "apiBaseUrl" | "appId" | "appSecret">): Lark.Client {
	if (!config.appId || !config.appSecret) {
		throw new Error("FEISHU_BOT_APP_ID and FEISHU_BOT_APP_SECRET are required.");
	}

	return new Lark.Client({
		appId: config.appId,
		appSecret: config.appSecret,
		appType: Lark.AppType.SelfBuild,
		domain: resolveDomain(config.apiBaseUrl),
		loggerLevel: Lark.LoggerLevel.info,
	});
}

export function createEventDispatcher(
	config: Pick<FeishuBotConfig, "encryptKey" | "verifyToken">,
	options: FeishuEventDispatcherOptions,
): Lark.EventDispatcher {
	return new Lark.EventDispatcher({
		encryptKey: config.encryptKey,
		verificationToken: config.verifyToken,
	}).register({
		"im.message.receive_v1": async (payload: unknown) => {
			const event = unwrapFeishuMessageEvent(payload);
			if (!event) {
				console.warn("[feishu] ignored unsupported im.message.receive_v1 payload shape");
				return;
			}
			await options.onMessage(event);
		},
	});
}

export function createWsClient(config: Pick<FeishuBotConfig, "apiBaseUrl" | "appId" | "appSecret">): Lark.WSClient {
	if (!config.appId || !config.appSecret) {
		throw new Error("FEISHU_BOT_APP_ID and FEISHU_BOT_APP_SECRET are required.");
	}

	return new Lark.WSClient({
		appId: config.appId,
		appSecret: config.appSecret,
		domain: resolveDomain(config.apiBaseUrl),
		loggerLevel: Lark.LoggerLevel.info,
	});
}

function resolveDomain(apiBaseUrl: string): Lark.Domain | string {
	const normalized = apiBaseUrl.trim();
	if (!normalized) {
		return Lark.Domain.Feishu;
	}

	const lower = normalized.toLowerCase();
	if (lower.includes("larksuite")) {
		return Lark.Domain.Lark;
	}
	if (lower.includes("feishu")) {
		return Lark.Domain.Feishu;
	}

	try {
		const parsed = new URL(normalized);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return normalized;
	}
}
