import type { ChannelContext } from "./context.js";

export interface AgentRunResult {
	stopReason: string;
	errorMessage?: string;
}

export interface AgentExecutor {
	run(context: ChannelContext): Promise<AgentRunResult>;
	abort?(): Promise<void> | void;
}

export class ChannelAgentRunner {
	constructor(private readonly executor: AgentExecutor) {}

	async run(context: ChannelContext): Promise<AgentRunResult> {
		return this.executor.run(context);
	}

	async abort(): Promise<void> {
		await this.executor.abort?.();
	}
}
