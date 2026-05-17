declare module "@mariozechner/pi-channel-core" {
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

	export interface ChannelContext {
		conversationDir?: string;
		message: IncomingMessage;
		reply: ReplyHandle;
	}

	export interface AgentRunResult {
		stopReason: string;
		errorMessage?: string;
	}

	export interface AgentExecutor {
		run(context: ChannelContext): Promise<AgentRunResult>;
		abort?(): Promise<void> | void;
	}

	export class ChannelAgentRunner {
		constructor(executor: AgentExecutor);
		run(context: ChannelContext): Promise<AgentRunResult>;
		abort(): Promise<void>;
	}

	export class ConversationQueue {
		enqueue(task: QueueTask): void;
		size(): number;
		clear(): void;
	}

	export class ChannelStore {
		constructor(workingDir: string);
		getConversationDir(conversationKey: string): string;
		getAttachmentsDir(conversationKey: string): string;
		getLogPath(conversationKey: string): string;
		logMessage(message: LoggedMessage): Promise<void>;
	}

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

	export function readChannelsConfig(agentDir: string): ChannelsConfigFile;
	export function createConversationKey(platform: string, kind: ConversationKind, targetId: string): string;
}
