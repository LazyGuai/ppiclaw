import { createReadStream } from "node:fs";
import { basename } from "node:path";
import type { Client } from "@larksuiteoapi/node-sdk";
import { createFeishuClient } from "./client.js";
import type { FeishuBotConfig } from "./config.js";
import { splitReplyChunks } from "./text-chunk.js";
import type { FeishuMessageEvent } from "./types.js";

const MAX_TEXT_LENGTH = 1800;
const FEISHU_MSG_TYPE_FILE = "file";
const FEISHU_MSG_TYPE_INTERACTIVE = "interactive";
const FEISHU_STREAM_STATE_MAX = 2000;
const FEISHU_STREAM_STATE_TTL_MS = 2 * 60 * 60 * 1000;
const FEISHU_CARDKIT_SUMMARY_MAX = 50;

interface FeishuMessageResult {
	code?: number;
	msg?: string;
	data?: {
		chat_id?: string;
		message_id?: string;
	};
}

interface FeishuFileUploadResult {
	file_key?: string;
}

interface FeishuReactionResult {
	code?: number;
	msg?: string;
	data?: {
		reaction_id?: string;
	};
}

interface FeishuTenantTokenResult {
	code?: number;
	msg?: string;
	tenant_access_token?: string;
	expire?: number;
}

interface FeishuCardKitCreateResult {
	code?: number;
	msg?: string;
	data?: {
		card_id?: string;
	};
}

interface FeishuCardKitResult {
	code?: number;
	msg?: string;
}

export interface FeishuReplyTextOptions {
	mode?: "final" | "stream";
}

interface CardKitStreamState {
	cardId: string;
	currentText: string;
	messageId: string;
	placeholderText: string;
	queue: Promise<void>;
	sequence: number;
	updatedAt: number;
}

interface TypingReactionState {
	reactionId: string;
	updatedAt: number;
}

interface TenantTokenState {
	expiresAt: number;
	token: string;
}

export class FeishuOpenApiClient {
	private client?: Client;
	private tenantToken?: TenantTokenState;
	private readonly cardKitStreamBySource = new Map<string, CardKitStreamState>();
	private readonly typingReactionBySource = new Map<string, TypingReactionState>();

	constructor(private readonly config: Pick<FeishuBotConfig, "apiBaseUrl" | "appId" | "appSecret" | "behavior">) {}

	isConfigured(): boolean {
		return Boolean(this.config.appId && this.config.appSecret);
	}

	async warmUp(): Promise<void> {
		if (!this.isConfigured()) {
			return;
		}
		try {
			this.getClient();
		} catch (error) {
			console.warn(`[feishu] warm-up skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async replyText(
		event: FeishuMessageEvent,
		text: string,
		_question?: string,
		options?: FeishuReplyTextOptions,
	): Promise<void> {
		const normalized = normalizeText(text);
		if (!normalized) {
			return;
		}

		const mode = options?.mode ?? "final";
		if (mode === "stream") {
			await this.sendStreamingReplace(event, normalized);
			return;
		}

		const chunks = splitReplyChunks(normalized, MAX_TEXT_LENGTH);
		const sourceKey = this.getSourceMessageKey(event);
		const existingSession = this.cardKitStreamBySource.get(sourceKey);
		if (existingSession && chunks.length > 0) {
			const closed = await this.closeCardKitSession(sourceKey, existingSession, chunks[0] ?? normalized);
			if (closed) {
				for (let index = 1; index < chunks.length; index += 1) {
					await this.sendCardViaCreate(event, chunks[index] ?? "");
				}
				return;
			}
		}

		for (let index = 0; index < chunks.length; index += 1) {
			const chunk = chunks[index];
			const useReply = index === 0;
			if (useReply) {
				const sent = await this.sendCardViaReply(event, chunk);
				if (sent) {
					continue;
				}
			}
			await this.sendCardViaCreate(event, chunk);
		}
	}

	async uploadFile(event: FeishuMessageEvent, filePath: string, title?: string): Promise<void> {
		const client = this.getClient();
		const fileName = sanitizeFileName(title?.trim() || basename(filePath) || "file");
		const uploadResult = (await client.im.file.create({
			data: {
				file_type: "stream",
				file_name: fileName,
				file: createReadStream(filePath),
			},
		})) as FeishuFileUploadResult | null;
		const fileKey = uploadResult?.file_key;
		if (!fileKey) {
			throw new Error("Feishu file upload failed: missing file_key");
		}

		const content = JSON.stringify({ file_key: fileKey });
		const replyResult = await this.sendReply(event, content, FEISHU_MSG_TYPE_FILE);
		if (replyResult && isSuccess(replyResult)) {
			return;
		}

		const createResult = (await client.im.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: event.message.chat_id,
				content,
				msg_type: FEISHU_MSG_TYPE_FILE,
			},
		})) as FeishuMessageResult;
		assertSuccess(createResult, "Feishu file send failed");
	}

	async setWorking(event: FeishuMessageEvent, working: boolean): Promise<void> {
		if (working) {
			await Promise.all([
				this.ensureCardKitSession(event, this.config.behavior.streamThinkingText),
				this.ensureTypingReaction(event),
			]);
			return;
		}
		await this.clearTypingReaction(event);
	}

	private async sendStreamingReplace(event: FeishuMessageEvent, text: string): Promise<void> {
		const sourceKey = this.getSourceMessageKey(event);
		const session = await this.ensureCardKitSession(event, this.config.behavior.streamThinkingText);
		if (!session) {
			await this.sendCardViaCreate(event, text);
			return;
		}

		const updated = await this.updateCardKitSession(sourceKey, session, text);
		if (updated) {
			return;
		}
	}

	private async sendCardViaReply(event: FeishuMessageEvent, text: string): Promise<boolean> {
		const replyResult = await this.sendReply(event, buildInteractiveCardContent(text), FEISHU_MSG_TYPE_INTERACTIVE);
		return Boolean(replyResult && isSuccess(replyResult));
	}

	private async sendCardViaCreate(event: FeishuMessageEvent, text: string): Promise<void> {
		const client = this.getClient();
		const createResult = (await client.im.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: event.message.chat_id,
				content: buildInteractiveCardContent(text),
				msg_type: FEISHU_MSG_TYPE_INTERACTIVE,
			},
		})) as FeishuMessageResult;
		assertSuccess(createResult, "Feishu send failed");
	}

	private async ensureCardKitSession(
		event: FeishuMessageEvent,
		initialText: string,
	): Promise<CardKitStreamState | undefined> {
		const sourceKey = this.getSourceMessageKey(event);
		this.pruneCardKitStreamState();

		const existing = this.cardKitStreamBySource.get(sourceKey);
		if (existing) {
			existing.updatedAt = Date.now();
			return existing;
		}

		try {
			const safeInitialText = sanitizeMarkdownForFeishuCard(initialText);
			const cardId = await this.createCardKitCard(safeInitialText);
			const messageId = await this.sendCardKitReferenceMessage(event, cardId);
			if (!messageId) {
				return undefined;
			}

			const state: CardKitStreamState = {
				cardId,
				currentText: safeInitialText,
				messageId,
				placeholderText: safeInitialText,
				queue: Promise.resolve(),
				sequence: 1,
				updatedAt: Date.now(),
			};
			this.setCardKitStreamState(sourceKey, state);
			return state;
		} catch (error) {
			console.warn(
				`[feishu] cardkit session create failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}

	private async updateCardKitSession(_sourceKey: string, state: CardKitStreamState, text: string): Promise<boolean> {
		const safeText = sanitizeMarkdownForFeishuCard(text);
		const baseText = shouldReplacePlaceholder(state) ? "" : state.currentText;
		const merged = mergeStreamingText(baseText, safeText);
		if (!merged || merged === baseText) {
			return true;
		}

		state.queue = state.queue.then(async () => {
			const liveBaseText = shouldReplacePlaceholder(state) ? "" : state.currentText;
			const nextText = mergeStreamingText(liveBaseText, merged);
			if (!nextText || nextText === state.currentText) {
				return;
			}
			const nextSequence = state.sequence + 1;
			await this.updateCardKitContent(state.cardId, nextSequence, nextText);
			state.currentText = nextText;
			state.sequence = nextSequence;
			state.updatedAt = Date.now();
		});

		try {
			await state.queue;
			return true;
		} catch (error) {
			state.queue = Promise.resolve();
			console.warn(
				`[feishu] cardkit stream update failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	private async closeCardKitSession(
		sourceKey: string,
		state: CardKitStreamState,
		finalText: string,
	): Promise<boolean> {
		try {
			const baseText = shouldReplacePlaceholder(state) ? "" : state.currentText;
			const mergedFinal = mergeStreamingText(baseText, finalText);
			const updated = await this.updateCardKitSession(sourceKey, state, mergedFinal);
			if (!updated) {
				return false;
			}

			await state.queue;
			const nextSequence = state.sequence + 1;
			await this.updateCardKitSettings(state.cardId, nextSequence, state.currentText);
			state.sequence = nextSequence;
			return true;
		} catch (error) {
			console.warn(
				`[feishu] cardkit stream close failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		} finally {
			this.cardKitStreamBySource.delete(sourceKey);
		}
	}

	private async createCardKitCard(initialText: string): Promise<string> {
		const card = {
			schema: "2.0",
			config: {
				streaming_mode: true,
				summary: { content: "[Generating...]" },
				streaming_config: {
					print_frequency_ms: { default: 50 },
					print_step: { default: 1 },
				},
			},
			body: {
				elements: [
					{
						tag: "markdown",
						content: initialText,
						element_id: "content",
					},
				],
			},
		};

		const result = await this.requestCardKit<FeishuCardKitCreateResult>("POST", "/cardkit/v1/cards", {
			type: "card_json",
			data: JSON.stringify(card),
		});
		const cardId = result.data?.card_id?.trim();
		if (!cardId) {
			throw new Error("missing card_id");
		}
		return cardId;
	}

	private async sendCardKitReferenceMessage(event: FeishuMessageEvent, cardId: string): Promise<string | undefined> {
		const cardContent = JSON.stringify({
			type: "card",
			data: {
				card_id: cardId,
			},
		});

		const replyResult = await this.sendReply(event, cardContent, FEISHU_MSG_TYPE_INTERACTIVE);
		const replyMessageId = this.readMessageId(replyResult);
		if (replyMessageId) {
			return replyMessageId;
		}

		const client = this.getClient();
		const createResult = (await client.im.message.create({
			params: {
				receive_id_type: "chat_id",
			},
			data: {
				receive_id: event.message.chat_id,
				content: cardContent,
				msg_type: FEISHU_MSG_TYPE_INTERACTIVE,
			},
		})) as FeishuMessageResult;
		assertSuccess(createResult, "Feishu cardkit reference send failed");
		return this.readMessageId(createResult);
	}

	private async updateCardKitContent(cardId: string, sequence: number, text: string): Promise<void> {
		await this.requestCardKit<FeishuCardKitResult>(
			"PUT",
			`/cardkit/v1/cards/${encodeURIComponent(cardId)}/elements/content/content`,
			{
				content: text,
				sequence,
				uuid: `s_${cardId}_${sequence}`,
			},
		);
	}

	private async updateCardKitSettings(cardId: string, sequence: number, finalText: string): Promise<void> {
		await this.requestCardKit<FeishuCardKitResult>(
			"PATCH",
			`/cardkit/v1/cards/${encodeURIComponent(cardId)}/settings`,
			{
				settings: JSON.stringify({
					config: {
						streaming_mode: false,
						summary: {
							content: truncateSummary(finalText, FEISHU_CARDKIT_SUMMARY_MAX),
						},
					},
				}),
				sequence,
				uuid: `c_${cardId}_${sequence}`,
			},
		);
	}

	private async requestCardKit<T extends { code?: number; msg?: string }>(
		method: "POST" | "PUT" | "PATCH",
		path: string,
		body: Record<string, unknown>,
	): Promise<T> {
		const apiBase = this.resolveOpenApiBase();
		const token = await this.getTenantAccessToken();
		const response = await fetch(`${apiBase}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`http ${response.status}`);
		}

		const result = (await response.json()) as T;
		assertSuccess(result, `Feishu CardKit ${method} ${path} failed`);
		return result;
	}

	private async getTenantAccessToken(): Promise<string> {
		const cached = this.tenantToken;
		if (cached && cached.expiresAt > Date.now() + 60_000) {
			return cached.token;
		}

		if (!this.config.appId || !this.config.appSecret) {
			throw new Error("missing app id or secret");
		}

		const apiBase = this.resolveOpenApiBase();
		const response = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				app_id: this.config.appId,
				app_secret: this.config.appSecret,
			}),
		});
		if (!response.ok) {
			throw new Error(`http ${response.status}`);
		}

		const result = (await response.json()) as FeishuTenantTokenResult;
		assertSuccess(result, "Feishu tenant token request failed");
		const token = result.tenant_access_token?.trim();
		if (!token) {
			throw new Error("Feishu tenant token request failed: missing tenant_access_token");
		}
		this.tenantToken = {
			token,
			expiresAt: Date.now() + (result.expire ?? 7200) * 1000,
		};
		return token;
	}

	private resolveOpenApiBase(): string {
		const normalized = (this.config.apiBaseUrl || "https://open.feishu.cn").trim().replace(/\/+$/, "");
		if (normalized.endsWith("/open-apis")) {
			return normalized;
		}
		return `${normalized}/open-apis`;
	}

	private async ensureTypingReaction(event: FeishuMessageEvent): Promise<void> {
		const sourceKey = this.getSourceMessageKey(event);
		this.pruneTypingState();
		const existing = this.typingReactionBySource.get(sourceKey);
		if (existing) {
			existing.updatedAt = Date.now();
			return;
		}

		const messageId = event.message.message_id?.trim();
		const reactionType = this.config.behavior.streamTypingReaction.trim();
		if (!messageId || !reactionType) {
			return;
		}

		try {
			const client = this.getClient();
			const result = (await client.im.messageReaction.create({
				path: {
					message_id: messageId,
				},
				data: {
					reaction_type: {
						emoji_type: reactionType,
					},
				},
			})) as FeishuReactionResult;
			if (!isSuccess(result)) {
				console.warn(`[feishu] typing reaction create failed: ${result.msg ?? `code=${result.code ?? "unknown"}`}`);
				return;
			}
			const reactionId = result.data?.reaction_id;
			if (!reactionId) {
				return;
			}
			this.setTypingState(sourceKey, reactionId);
		} catch (error) {
			console.warn(
				`[feishu] typing reaction create failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async clearTypingReaction(event: FeishuMessageEvent): Promise<void> {
		const sourceKey = this.getSourceMessageKey(event);
		const existing = this.typingReactionBySource.get(sourceKey);
		if (!existing) {
			return;
		}
		this.typingReactionBySource.delete(sourceKey);
		const messageId = event.message.message_id?.trim();
		if (!messageId) {
			return;
		}

		try {
			const client = this.getClient();
			const result = (await client.im.messageReaction.delete({
				path: {
					message_id: messageId,
					reaction_id: existing.reactionId,
				},
			})) as FeishuReactionResult;
			if (!isSuccess(result)) {
				console.warn(`[feishu] typing reaction delete failed: ${result.msg ?? `code=${result.code ?? "unknown"}`}`);
			}
		} catch (error) {
			console.warn(
				`[feishu] typing reaction delete failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async sendReply(
		event: FeishuMessageEvent,
		content: string,
		msgType: string,
	): Promise<FeishuMessageResult | undefined> {
		const messageId = event.message.message_id?.trim();
		if (!messageId) {
			return undefined;
		}

		const client = this.getClient();
		const replyResult = (await client.im.message.reply({
			path: { message_id: messageId },
			data: {
				content,
				msg_type: msgType,
				reply_in_thread: Boolean(event.message.thread_id),
			},
		})) as FeishuMessageResult;

		if (!isSuccess(replyResult)) {
			console.warn(
				`[feishu] reply failed, fallback to create: ${replyResult.msg ?? `code=${replyResult.code ?? "unknown"}`}`,
			);
		}
		return replyResult;
	}

	private getSourceMessageKey(event: FeishuMessageEvent): string {
		return event.message.message_id;
	}

	private setCardKitStreamState(sourceKey: string, state: CardKitStreamState): void {
		this.cardKitStreamBySource.set(sourceKey, state);
		if (this.cardKitStreamBySource.size > FEISHU_STREAM_STATE_MAX) {
			const oldestKey = this.cardKitStreamBySource.keys().next().value;
			if (oldestKey) {
				this.cardKitStreamBySource.delete(oldestKey);
			}
		}
	}

	private setTypingState(sourceKey: string, reactionId: string): void {
		this.typingReactionBySource.set(sourceKey, {
			reactionId,
			updatedAt: Date.now(),
		});
		if (this.typingReactionBySource.size > FEISHU_STREAM_STATE_MAX) {
			const oldestKey = this.typingReactionBySource.keys().next().value;
			if (oldestKey) {
				this.typingReactionBySource.delete(oldestKey);
			}
		}
	}

	private pruneCardKitStreamState(): void {
		const now = Date.now();
		for (const [key, value] of this.cardKitStreamBySource) {
			if (now - value.updatedAt > FEISHU_STREAM_STATE_TTL_MS) {
				this.cardKitStreamBySource.delete(key);
			}
		}
	}

	private pruneTypingState(): void {
		const now = Date.now();
		for (const [key, value] of this.typingReactionBySource) {
			if (now - value.updatedAt > FEISHU_STREAM_STATE_TTL_MS) {
				this.typingReactionBySource.delete(key);
			}
		}
	}

	private readMessageId(result: FeishuMessageResult | undefined): string | undefined {
		const messageId = result?.data?.message_id;
		return typeof messageId === "string" && messageId.trim() ? messageId : undefined;
	}

	private getClient(): Client {
		if (!this.client) {
			this.client = createFeishuClient(this.config);
		}
		return this.client;
	}
}

function isSuccess(result: { code?: number }): boolean {
	return (result.code ?? 0) === 0;
}

function assertSuccess(result: { code?: number; msg?: string }, message: string): void {
	if (!isSuccess(result)) {
		throw new Error(`${message}: ${result.msg ?? `code=${result.code ?? "unknown"}`}`);
	}
}

function sanitizeFileName(name: string): string {
	const fallback = "file";
	const normalized = name.replace(/[\\/:*?"<>|]/g, "_").trim();
	return normalized || fallback;
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function truncateSummary(text: string, max: number): string {
	if (!text) {
		return "";
	}
	const clean = text.replace(/\n/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 3))}...`;
}

function buildInteractiveCardContent(text: string): string {
	return JSON.stringify({
		schema: "2.0",
		config: {
			width_mode: "fill",
		},
		body: {
			elements: [
				{
					tag: "markdown",
					content: sanitizeMarkdownForFeishuCard(text),
				},
			],
		},
	});
}

function sanitizeMarkdownForFeishuCard(text: string): string {
	const lines = text.split("\n");
	let inFence = false;
	let fenceChar = "";
	let fenceLen = 0;

	return lines
		.map((line) => {
			const marker = line.match(/^( {0,3})(`{3,}|~{3,})/);
			if (marker?.[2]) {
				const token = marker[2];
				if (!inFence) {
					inFence = true;
					fenceChar = token[0] ?? "";
					fenceLen = token.length;
				} else if (token[0] === fenceChar && token.length >= fenceLen) {
					inFence = false;
					fenceChar = "";
					fenceLen = 0;
				}
				return line;
			}
			if (inFence) {
				return line;
			}
			return line.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (full: string, alt: string, url: string) => {
				const trimmedUrl = url.trim();
				if (isLikelyFeishuImageKey(trimmedUrl)) {
					return full;
				}
				if (!/^https?:\/\//i.test(trimmedUrl)) {
					return full;
				}
				const label = alt.trim() || "image";
				return `[${label}](${trimmedUrl})`;
			});
		})
		.join("\n");
}

function isLikelyFeishuImageKey(value: string): boolean {
	return /^img[_-]/i.test(value);
}

function shouldReplacePlaceholder(state: CardKitStreamState): boolean {
	return state.currentText === state.placeholderText;
}

function mergeStreamingText(previousText: string | undefined, nextText: string | undefined): string {
	const previous = typeof previousText === "string" ? previousText : "";
	const next = typeof nextText === "string" ? nextText : "";
	if (!next) {
		return previous;
	}
	if (!previous || next === previous) {
		return next;
	}
	if (next.startsWith(previous)) {
		return next;
	}
	if (previous.startsWith(next)) {
		return previous;
	}
	if (next.includes(previous)) {
		return next;
	}
	if (previous.includes(next)) {
		return previous;
	}
	const maxOverlap = Math.min(previous.length, next.length);
	for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
		if (previous.slice(-overlap) === next.slice(0, overlap)) {
			return `${previous}${next.slice(overlap)}`;
		}
	}
	return `${previous}${next}`;
}
