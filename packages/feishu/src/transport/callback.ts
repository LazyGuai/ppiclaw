import { createServer, type Server } from "node:http";
import { adaptDefault, type EventDispatcher } from "@larksuiteoapi/node-sdk";

export interface FeishuCallbackTransportOptions {
	eventDispatcher: EventDispatcher;
	host: string;
	path: string;
	port: number;
}

export class FeishuCallbackTransport {
	private server?: Server;

	constructor(private readonly options: FeishuCallbackTransportOptions) {}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}

		const handler = adaptDefault(this.options.path, this.options.eventDispatcher, {
			autoChallenge: true,
		});
		this.server = createServer((req, res) => {
			void handler(req, res);
		});

		await new Promise<void>((resolve, reject) => {
			this.server?.once("error", reject);
			this.server?.listen(this.options.port, this.options.host, () => resolve());
		});
	}

	async stop(): Promise<void> {
		if (!this.server) {
			return;
		}

		const current = this.server;
		this.server = undefined;
		await new Promise<void>((resolve, reject) => {
			current.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}
}
