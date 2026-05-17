import type { ReplyHandle } from "@mariozechner/pi-channel-core";
import { parseAssistantOutput } from "./assistant-output.js";

export interface StreamUpdaterOptions {
	forceSendChars: number;
	maxUpdates: number;
	minDelayMs?: number;
	minIntervalMs: number;
	minNewChars: number;
	preferNaturalBoundary?: boolean;
}

export interface StreamUpdater {
	flush(): Promise<void>;
	hasSent(): boolean;
	push(text: string): void;
}

export function createStreamUpdater(reply: ReplyHandle, options: StreamUpdaterOptions): StreamUpdater {
	const replacer = reply.replace;
	if (!replacer) {
		return {
			push(): void {},
			async flush(): Promise<void> {},
			hasSent(): boolean {
				return false;
			},
		};
	}

	let chain = Promise.resolve();
	const startAt = Date.now();
	let lastSentAt = 0;
	let lastSentText = "";
	let pendingText = "";
	let sentCount = 0;
	let sentAny = false;

	const queueSend = (text: string): void => {
		lastSentAt = Date.now();
		lastSentText = text;
		sentCount += 1;
		sentAny = true;
		chain = chain
			.then(async () => {
				await replacer(text);
			})
			.catch((error) => {
				console.warn(`[feishu] stream update failed: ${error instanceof Error ? error.message : String(error)}`);
			});
	};

	const shouldSendNow = (text: string, force = false): boolean => {
		if (sentCount >= options.maxUpdates) {
			return false;
		}
		const now = Date.now();
		if (!force && options.minDelayMs && now - startAt < options.minDelayMs) {
			return false;
		}

		const isAppendOnly = text.startsWith(lastSentText);
		const newChars = isAppendOnly ? text.length - lastSentText.length : text.length;
		if (!force && isAppendOnly && newChars < options.minNewChars) {
			return false;
		}
		if (!force && isAppendOnly && options.preferNaturalBoundary) {
			const atBoundary = endsWithNaturalBoundary(text);
			if (!atBoundary && newChars < options.forceSendChars) {
				return false;
			}
		}
		if (!force && now - lastSentAt < options.minIntervalMs) {
			return false;
		}
		return true;
	};

	return {
		push(text: string): void {
			const normalized = parseAssistantOutput(text).text;
			if (!normalized) {
				return;
			}

			const base = pendingText || lastSentText;
			const merged = mergeStreamingText(base, normalized);
			if (!merged || merged === lastSentText || merged === pendingText) {
				return;
			}

			pendingText = merged;
			if (!shouldSendNow(pendingText)) {
				return;
			}

			const toSend = pendingText;
			pendingText = "";
			queueSend(toSend);
		},
		async flush(): Promise<void> {
			if (pendingText && pendingText !== lastSentText && shouldSendNow(pendingText, true)) {
				const toSend = pendingText;
				pendingText = "";
				queueSend(toSend);
			}
			await chain;
		},
		hasSent(): boolean {
			return sentAny;
		},
	};
}

export function mergeStreamingText(previousText: string | undefined, nextText: string | undefined): string {
	const previous = typeof previousText === "string" ? previousText : "";
	const next = typeof nextText === "string" ? nextText : "";
	if (!next) {
		return previous;
	}
	if (!previous || next === previous) {
		return next;
	}
	if (next.startsWith(previous)) {
		return next;
	}
	if (previous.startsWith(next)) {
		return previous;
	}
	if (next.includes(previous)) {
		return next;
	}
	if (previous.includes(next)) {
		return previous;
	}

	const maxOverlap = Math.min(previous.length, next.length);
	for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
		if (previous.slice(-overlap) === next.slice(0, overlap)) {
			return `${previous}${next.slice(overlap)}`;
		}
	}
	return `${previous}${next}`;
}

function endsWithNaturalBoundary(text: string): boolean {
	const trimmed = text.trimEnd();
	if (!trimmed) {
		return false;
	}
	const lastChar = trimmed.at(-1);
	if (!lastChar) {
		return false;
	}
	if (isSentenceBoundary(lastChar)) {
		return true;
	}
	if (isClosable(lastChar)) {
		for (let i = trimmed.length - 2; i >= 0; i -= 1) {
			const char = trimmed[i];
			if (isSentenceBoundary(char)) {
				return true;
			}
			if (!isClosable(char)) {
				return false;
			}
		}
	}
	return false;
}

function isSentenceBoundary(char: string): boolean {
	return ".?!;\n。！？；".includes(char);
}

function isClosable(char: string): boolean {
	return "\"')]}】」』".includes(char);
}
