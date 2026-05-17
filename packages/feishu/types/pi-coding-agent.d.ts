declare module "@mariozechner/pi-coding-agent" {
	export interface AgentSessionContentPart {
		type: string;
		text?: string;
	}

	export interface AgentSessionMessage {
		role: string;
		content: AgentSessionContentPart[];
	}

	export interface AgentSession {
		model?: unknown;
		messages: AgentSessionMessage[];
		prompt(text: string): Promise<void>;
		abort(): Promise<void>;
	}

	export interface CreateAgentSessionResult {
		session: AgentSession;
		modelFallbackMessage?: string;
	}

	export interface CreateAgentSessionOptions {
		cwd?: string;
		agentDir?: string;
		customTools?: unknown[];
		resourceLoader?: ResourceLoader;
		sessionManager?: SessionManager;
	}

	export interface ResourceLoader {
		reload(): Promise<void>;
	}

	export interface DefaultResourceLoaderOptions {
		cwd?: string;
		agentDir?: string;
		additionalSkillPaths?: string[];
	}

	export class DefaultResourceLoader implements ResourceLoader {
		constructor(options: DefaultResourceLoaderOptions);
		reload(): Promise<void>;
	}

	export interface SessionManager {}

	export interface SessionManagerStatic {
		open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager;
	}

	export const SessionManager: SessionManagerStatic;

	export function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
	export function getAgentDir(): string;
}
