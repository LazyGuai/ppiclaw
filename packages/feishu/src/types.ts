export interface FeishuMention {
	id?: {
		open_id?: string;
		union_id?: string;
		user_id?: string;
	};
	key?: string;
	name?: string;
	tenant_key?: string;
}

export interface FeishuMessageEvent {
	sender: {
		sender_id: {
			open_id?: string;
			union_id?: string;
			user_id?: string;
		};
		sender_type?: string;
		tenant_key?: string;
	};
	message: {
		chat_id: string;
		chat_type: "group" | "p2p" | "private";
		content: string;
		create_time?: string;
		message_id: string;
		message_type: string;
		mentions?: FeishuMention[];
		parent_id?: string;
		root_id?: string;
		thread_id?: string;
	};
}

export type FeishuTransport = "callback" | "long-connection";

export type FeishuDomain = "feishu" | "lark" | string;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function unwrapFeishuMessageEvent(input: unknown): FeishuMessageEvent | undefined {
	if (!isRecord(input)) {
		return undefined;
	}

	const direct = parseFeishuMessageEvent(input);
	if (direct) {
		return direct;
	}

	const event = input.event;
	if (isRecord(event)) {
		const parsed = parseFeishuMessageEvent(event);
		if (parsed) {
			return parsed;
		}
	}

	const data = input.data;
	if (isRecord(data)) {
		const parsed = parseFeishuMessageEvent(data);
		if (parsed) {
			return parsed;
		}
	}

	return undefined;
}

function parseFeishuMessageEvent(input: Record<string, unknown>): FeishuMessageEvent | undefined {
	const sender = input.sender;
	const message = input.message;
	if (!isRecord(sender) || !isRecord(message)) {
		return undefined;
	}

	const senderId = sender.sender_id;
	if (!isRecord(senderId)) {
		return undefined;
	}

	const messageId = toOptionalString(message.message_id);
	const chatId = toOptionalString(message.chat_id);
	const chatType = toOptionalString(message.chat_type);
	const messageType = toOptionalString(message.message_type);
	const content = typeof message.content === "string" ? message.content : "";
	if (!messageId || !chatId || !chatType || !messageType) {
		return undefined;
	}
	if (chatType !== "group" && chatType !== "p2p" && chatType !== "private") {
		return undefined;
	}

	const mentions = Array.isArray(message.mentions)
		? message.mentions
				.filter((mention): mention is Record<string, unknown> => isRecord(mention))
				.map((mention) => ({
					id: isRecord(mention.id)
						? {
								open_id: toOptionalString(mention.id.open_id),
								union_id: toOptionalString(mention.id.union_id),
								user_id: toOptionalString(mention.id.user_id),
							}
						: undefined,
					key: toOptionalString(mention.key),
					name: toOptionalString(mention.name),
					tenant_key: toOptionalString(mention.tenant_key),
				}))
		: undefined;

	return {
		sender: {
			sender_id: {
				open_id: toOptionalString(senderId.open_id),
				union_id: toOptionalString(senderId.union_id),
				user_id: toOptionalString(senderId.user_id),
			},
			sender_type: toOptionalString(sender.sender_type),
			tenant_key: toOptionalString(sender.tenant_key),
		},
		message: {
			chat_id: chatId,
			chat_type: chatType,
			content,
			create_time: toOptionalString(message.create_time),
			message_id: messageId,
			message_type: messageType,
			mentions,
			parent_id: toOptionalString(message.parent_id),
			root_id: toOptionalString(message.root_id),
			thread_id: toOptionalString(message.thread_id),
		},
	};
}
