import { type AttachmentRef, createConversationKey, type IncomingMessage } from "@mariozechner/pi-channel-core";
import type { FeishuMention, FeishuMessageEvent } from "./types.js";

export interface FeishuMappingOptions {
	botOpenId?: string;
}

interface ContentDescriptor {
	attachments: AttachmentRef[];
	text: string;
}

export function mapFeishuEventToIncomingMessage(
	event: FeishuMessageEvent,
	options: FeishuMappingOptions = {},
): IncomingMessage {
	const isDirect = event.message.chat_type === "p2p" || event.message.chat_type === "private";
	const senderId =
		event.sender.sender_id.open_id ??
		event.sender.sender_id.user_id ??
		event.sender.sender_id.union_id ??
		"unknown-user";
	const content = describeMessageContent(event.message.message_type, event.message.content);
	const conversationTarget = buildConversationTarget(event, isDirect, senderId);

	return {
		platform: "feishu",
		conversationKey: createConversationKey("feishu", isDirect ? "dm" : "group", conversationTarget),
		messageId: event.message.message_id,
		senderId,
		text: content.text,
		isDirect,
		isMentioned: isDirect ? true : checkBotMentioned(event.message.mentions, options.botOpenId),
		attachments: content.attachments,
		rawEvent: event,
	};
}

function buildConversationTarget(event: FeishuMessageEvent, isDirect: boolean, senderId: string): string {
	if (isDirect) {
		return senderId || event.message.chat_id;
	}

	const topicId = event.message.thread_id ?? event.message.root_id;
	if (topicId) {
		return `${event.message.chat_id}:topic:${topicId}`;
	}
	return event.message.chat_id;
}

function checkBotMentioned(mentions: FeishuMention[] | undefined, botOpenId: string | undefined): boolean {
	if (!mentions?.length) {
		return false;
	}

	if (!botOpenId?.trim()) {
		return true;
	}

	const expected = botOpenId.trim();
	return mentions.some((mention) => mention.id?.open_id?.trim() === expected);
}

function describeMessageContent(messageType: string, rawContent: string): ContentDescriptor {
	const parsed = parseJsonObject(rawContent);
	switch (messageType) {
		case "text":
			return {
				attachments: [],
				text: normalizeText((parsed?.text as string | undefined) ?? ""),
			};
		case "post":
			return {
				attachments: [],
				text: normalizeText(parsePostText(parsed)),
			};
		case "image": {
			const imageKey = readString(parsed, "image_key");
			return {
				attachments: imageKey ? [{ id: imageKey, name: "image", mimeType: "image/*" }] : [],
				text: "[Image attachment]",
			};
		}
		case "file": {
			const fileKey = readString(parsed, "file_key");
			const fileName = readString(parsed, "file_name");
			return {
				attachments: fileKey
					? [{ id: fileKey, name: fileName ?? "file", mimeType: "application/octet-stream" }]
					: [],
				text: `[File attachment] ${fileName ?? "file"}`,
			};
		}
		case "audio":
			return {
				attachments: [],
				text: "[Audio attachment]",
			};
		case "media":
		case "video":
			return {
				attachments: [],
				text: "[Video attachment]",
			};
		default:
			return {
				attachments: [],
				text: normalizeText(rawContent) || `[${messageType} message]`,
			};
	}
}

function parsePostText(content: Record<string, unknown> | undefined): string {
	if (!content) {
		return "";
	}
	const zh = content.zh_cn;
	if (!isRecord(zh)) {
		return "";
	}
	const rows = zh.content;
	if (!Array.isArray(rows)) {
		return "";
	}

	const lines: string[] = [];
	for (const row of rows) {
		if (!Array.isArray(row)) {
			continue;
		}

		const line = row
			.map((item) => {
				if (!isRecord(item)) {
					return "";
				}
				const text = readString(item, "text");
				if (text) {
					return text;
				}
				const href = readString(item, "href");
				if (href) {
					return href;
				}
				const userName = readString(item, "user_name");
				if (userName) {
					return `@${userName}`;
				}
				return "";
			})
			.filter(Boolean)
			.join("");

		if (line.trim()) {
			lines.push(line.trim());
		}
	}

	return lines.join("\n");
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
	if (!value.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
	if (!record) {
		return undefined;
	}
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
