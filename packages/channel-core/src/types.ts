export interface AttachmentRef {
	id?: string;
	name?: string;
	mimeType?: string;
	sizeBytes?: number;
	platformUrl?: string;
	localPath?: string;
}

export interface IncomingMessage {
	platform: string;
	conversationKey: string;
	messageId: string;
	senderId: string;
	senderName?: string;
	text: string;
	isDirect: boolean;
	isMentioned: boolean;
	attachments: AttachmentRef[];
	rawEvent?: unknown;
}

export interface ReplyHandle {
	reply(text: string): Promise<void>;
	replace?(text: string): Promise<void>;
	replyInThread?(text: string): Promise<void>;
	uploadFile?(path: string, title?: string): Promise<void>;
	setWorking?(working: boolean): Promise<void>;
	delete?(): Promise<void>;
}

export interface ChannelAdapter {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface LoggedMessage {
	date: string;
	messageId: string;
	platform: string;
	conversationKey: string;
	senderId: string;
	senderName?: string;
	text: string;
	attachments: AttachmentRef[];
}

export type ConversationKind = "dm" | "group" | "channel";

export interface QueueTask {
	label: string;
	run: () => Promise<void>;
}
