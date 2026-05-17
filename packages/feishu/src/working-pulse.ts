import type { ReplyHandle } from "@mariozechner/pi-channel-core";

export interface WorkingPulseOptions {
	earlyRefreshScheduleMs: number[];
	initialWaitMs: number;
	minVisibleMs: number;
	pulseIntervalMs: number;
	sendCancel: boolean;
}

export interface WorkingPulseController {
	awaitInitialSend: () => Promise<void>;
	stop: () => Promise<void>;
}

export function startWorkingPulse(reply: ReplyHandle, options: WorkingPulseOptions): WorkingPulseController {
	let closed = false;
	const startedAt = Date.now();
	let inFlight = Promise.resolve();
	const queueSetWorking = (working: boolean): Promise<void> => {
		inFlight = inFlight
			.then(async () => {
				if (closed && working) {
					return;
				}
				try {
					await reply.setWorking?.(working);
				} catch {
					// Ignore working-state delivery failures to avoid blocking the final reply.
				}
			})
			.catch(() => undefined);
		return inFlight;
	};

	const initialSend = queueSetWorking(true);
	const earlyRefreshTimers = options.earlyRefreshScheduleMs.map((ms) =>
		setTimeout(() => {
			if (closed) {
				return;
			}
			void queueSetWorking(true);
		}, ms),
	);
	const interval = setInterval(() => {
		if (closed) {
			return;
		}
		void queueSetWorking(true);
	}, options.pulseIntervalMs);

	return {
		awaitInitialSend: async () => {
			await waitForPromiseWithTimeout(initialSend, options.initialWaitMs);
		},
		stop: async () => {
			if (closed) {
				return;
			}
			closed = true;
			for (const timer of earlyRefreshTimers) {
				clearTimeout(timer);
			}
			clearInterval(interval);
			await waitForMinimumWorkingVisibility(startedAt, options.minVisibleMs);
			if (options.sendCancel) {
				await queueSetWorking(false);
				return;
			}
			await inFlight;
		},
	};
}

async function waitForPromiseWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
	let timeout: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			promise,
			new Promise<void>((resolve) => {
				timeout = setTimeout(resolve, timeoutMs);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

async function waitForMinimumWorkingVisibility(startedAt: number, minVisibleMs: number): Promise<void> {
	const elapsed = Date.now() - startedAt;
	if (elapsed >= minVisibleMs) {
		return;
	}
	await sleep(minVisibleMs - elapsed);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
