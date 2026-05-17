import type { IncomingMessage, ReplyHandle } from "./types.js";

export interface ChannelContext {
	conversationDir?: string;
	message: IncomingMessage;
	reply: ReplyHandle;
}
