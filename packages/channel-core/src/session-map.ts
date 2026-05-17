import type { ConversationKind } from "./types.js";

export function createConversationKey(platform: string, kind: ConversationKind, targetId: string): string {
	return `${platform}:${kind}:${targetId}`;
}

export class SessionMap<T> {
	private readonly values = new Map<string, T>();

	get(key: string): T | undefined {
		return this.values.get(key);
	}

	getOrCreate(key: string, factory: () => T): T {
		const existing = this.values.get(key);
		if (existing) {
			return existing;
		}

		const created = factory();
		this.values.set(key, created);
		return created;
	}

	set(key: string, value: T): void {
		this.values.set(key, value);
	}

	delete(key: string): boolean {
		return this.values.delete(key);
	}

	keys(): string[] {
		return Array.from(this.values.keys());
	}
}
