import type { EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import { createWsClient } from "../client.js";
import type { FeishuBotConfig } from "../config.js";

export interface FeishuLongConnectionTransportOptions {
	config: Pick<FeishuBotConfig, "apiBaseUrl" | "appId" | "appSecret">;
	eventDispatcher: EventDispatcher;
}

export class FeishuLongConnectionTransport {
	private started = false;
	private wsClient?: WSClient;

	constructor(private readonly options: FeishuLongConnectionTransportOptions) {}

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		this.wsClient = createWsClient(this.options.config);
		await this.wsClient.start({
			eventDispatcher: this.options.eventDispatcher,
		});
	}

	async stop(): Promise<void> {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.wsClient?.close();
		this.wsClient = undefined;
	}
}
