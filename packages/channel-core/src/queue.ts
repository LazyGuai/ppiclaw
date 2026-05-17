import type { QueueTask } from "./types.js";

export class ConversationQueue {
	private readonly tasks: QueueTask[] = [];
	private processing = false;

	enqueue(task: QueueTask): void {
		this.tasks.push(task);
		void this.processNext();
	}

	size(): number {
		return this.tasks.length;
	}

	clear(): void {
		this.tasks.length = 0;
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.tasks.length === 0) {
			return;
		}

		this.processing = true;
		const task = this.tasks.shift();

		if (!task) {
			this.processing = false;
			return;
		}

		try {
			await task.run();
		} catch (error) {
			console.error(
				`[channel-core] queue task failed (${task.label}): ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		} finally {
			this.processing = false;
			await this.processNext();
		}
	}
}
