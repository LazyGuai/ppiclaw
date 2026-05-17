import type { IncomingMessage } from "@mariozechner/pi-channel-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";

export interface SendFileDirective {
	path: string;
	title?: string;
}

export interface ParsedAssistantOutput {
	files: SendFileDirective[];
	text: string;
}

export function extractAssistantTextFromMessage(message: unknown): string {
	if (!message || typeof message !== "object") {
		return "";
	}

	const maybeAssistant = message as {
		content?: unknown;
		role?: string;
	};
	if (maybeAssistant.role !== "assistant" || !Array.isArray(maybeAssistant.content)) {
		return "";
	}

	return maybeAssistant.content
		.filter((part): part is { text: string; type: "text" } => {
			if (!part || typeof part !== "object") {
				return false;
			}
			return (
				(part as { text?: unknown; type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string"
			);
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function extractSendableOutput(session: AgentSession, startIndex: number): ParsedAssistantOutput {
	const assistantTexts: string[] = [];
	for (const message of session.messages.slice(startIndex)) {
		if (message.role !== "assistant") {
			continue;
		}
		const text = message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) {
			assistantTexts.push(text);
		}
	}

	const combined = normalizeText(assistantTexts.join("\n\n"));
	if (combined) {
		const parsed = parseAssistantOutput(combined);
		if (parsed.text || parsed.files.length > 0) {
			return {
				text: parsed.text,
				files: dedupeFileDirectives(parsed.files),
			};
		}
	}

	const fallbackText = extractFinalAssistantText(session, startIndex);
	if (!fallbackText) {
		return { text: "", files: [] };
	}
	const fallbackParsed = parseAssistantOutput(fallbackText);
	return {
		text: fallbackParsed.text,
		files: dedupeFileDirectives(fallbackParsed.files),
	};
}

export function parseAssistantOutput(text: string): ParsedAssistantOutput {
	const cleanedText = sanitizeAssistantText(text);
	const extracted = extractSendTagDirectives(cleanedText);
	const directives: SendFileDirective[] = [...extracted.files];

	const lines = extracted.text.split("\n");
	const keptLines: string[] = [];
	for (const line of lines) {
		const lineDirective = parseLineFileDirective(line);
		if (lineDirective) {
			if (!isPlaceholderPath(lineDirective.path)) {
				directives.push(lineDirective);
			}
			continue;
		}
		keptLines.push(line);
	}
	const trailing = stripTrailingSendProtocolFragments(keptLines.join("\n"), {
		hasDirectives: directives.length > 0,
		sawSendLikeTag: extracted.sawSendLikeTag,
	});
	const trailingPath = readDirectiveAttribute(trailing.trailingBlock, "path");
	if (trailingPath && !isPlaceholderPath(trailingPath)) {
		directives.push({
			path: trailingPath,
			title: readDirectiveAttribute(trailing.trailingBlock, "title"),
		});
	}

	return {
		files: dedupeFileDirectives(directives),
		text: normalizeText(trailing.strippedText),
	};
}

interface SendTagExtractionResult {
	files: SendFileDirective[];
	sawSendLikeTag: boolean;
	text: string;
}

interface TrailingSendProtocolStripResult {
	strippedText: string;
	trailingBlock: string;
}

function extractSendTagDirectives(text: string): SendTagExtractionResult {
	const files: SendFileDirective[] = [];
	let sawSendLikeTag = false;
	const withoutTags = text.replace(/<\s*\/?\s*send(?:[_\s-]?file)?\b([\s\S]*?)>/gim, (whole, attrs: string) => {
		sawSendLikeTag = true;
		if (/^<\s*\//.test(whole)) {
			return "";
		}

		const path = readDirectiveAttribute(attrs, "path");
		if (!path || isPlaceholderPath(path)) {
			return "";
		}
		files.push({
			path,
			title: readDirectiveAttribute(attrs, "title"),
		});
		return "";
	});

	return {
		files,
		sawSendLikeTag,
		text: withoutTags,
	};
}

function stripTrailingSendProtocolFragments(
	text: string,
	context: { hasDirectives: boolean; sawSendLikeTag: boolean },
): TrailingSendProtocolStripResult {
	const lines = text.split("\n");
	let i = lines.length - 1;
	while (i >= 0 && !lines[i]?.trim()) {
		i -= 1;
	}
	if (i < 0) {
		return { strippedText: "", trailingBlock: "" };
	}

	const lastNonEmptyIndex = i;
	const removedLines: string[] = [];
	let seenFragment = false;
	for (; i >= 0; i -= 1) {
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();
		if (
			isSendFileFragmentLine(trimmed, {
				allowLooseAngle: context.hasDirectives || context.sawSendLikeTag || seenFragment || i === lastNonEmptyIndex,
			})
		) {
			seenFragment = true;
			removedLines.unshift(raw);
			continue;
		}
		if (seenFragment && !trimmed) {
			removedLines.unshift(raw);
			continue;
		}
		break;
	}

	if (!seenFragment) {
		return { strippedText: text, trailingBlock: "" };
	}
	return {
		strippedText: lines.slice(0, i + 1).join("\n"),
		trailingBlock: removedLines.join("\n"),
	};
}

export function parseDirectSendFileCommand(text: string): SendFileDirective | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	const match = /^\s*(?:\/sendfile|\u53d1\u9001\u6587\u4ef6)\s+(.+?)\s*$/i.exec(trimmed);
	if (!match?.[1]) {
		return undefined;
	}
	return parseLineFileDirective(`send_file: ${match[1]}`);
}

export function buildNoTextRecoveryPrompt(message: IncomingMessage): string {
	const userText = message.text?.trim() || "(empty message)";
	return [
		"[internal retry instruction, do not expose]",
		"Your previous reply produced no sendable output (for example only thinking/tool traces).",
		"Please answer the user again with a final, user-facing response.",
		"Requirements:",
		"- Output normal readable text only.",
		"- Do not output hidden thinking/tool traces.",
		"- If a file must be sent, append one line only at the end:",
		'  <send_file path="relative/or/absolute/path" title="optional filename" />',
		"",
		"Original user message:",
		userText,
	].join("\n");
}

export function buildFileSentMessage(sent: number): string {
	return sent > 1 ? `Sent ${sent} files.` : "File sent.";
}

function extractFinalAssistantText(session: AgentSession, startIndex = 0): string {
	const assistantMessage = session.messages
		.slice(startIndex)
		.slice()
		.reverse()
		.find((message) => message.role === "assistant");

	if (!assistantMessage) {
		return "";
	}

	return assistantMessage.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function dedupeFileDirectives(files: SendFileDirective[]): SendFileDirective[] {
	const seen = new Set<string>();
	const deduped: SendFileDirective[] = [];
	for (const file of files) {
		const key = `${file.path}\u0000${file.title ?? ""}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(file);
	}
	return deduped;
}

function parseLineFileDirective(line: string): SendFileDirective | undefined {
	const match = /^\s*(?:send[_\s]?file|sendfile|\u53d1\u9001\u6587\u4ef6)\s*[:\uff1a]\s*(.+?)\s*$/i.exec(line);
	if (!match?.[1]) {
		return undefined;
	}
	const content = stripWrapping(match[1].trim());
	const markdownLink = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(content);
	if (markdownLink?.[2]) {
		return {
			path: stripWrapping(markdownLink[2].trim()),
			title: stripWrapping(markdownLink[1].trim()),
		};
	}

	const splitter = /[|\uff5c]/.exec(content);
	if (!splitter || splitter.index === undefined) {
		return {
			path: stripWrapping(content),
		};
	}
	return {
		path: stripWrapping(content.slice(0, splitter.index).trim()),
		title: stripWrapping(content.slice(splitter.index + 1).trim()),
	};
}

function readDirectiveAttribute(attrs: string, name: string): string | undefined {
	const quoted = new RegExp(`${name}\\s*=\\s*"([^"]+)"`, "i").exec(attrs);
	if (quoted?.[1]) {
		return quoted[1].trim();
	}

	const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']+)'`, "i").exec(attrs);
	if (singleQuoted?.[1]) {
		return singleQuoted[1].trim();
	}
	const unicodeQuoted = new RegExp(`${name}\\s*=\\s*[\\u201c\\u201d]([^\\u201c\\u201d]+)[\\u201c\\u201d]`, "i").exec(
		attrs,
	);
	if (unicodeQuoted?.[1]) {
		return unicodeQuoted[1].trim();
	}

	const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attrs);
	if (unquoted?.[1]) {
		return unquoted[1].trim().replace(/[/>]+$/, "");
	}

	return undefined;
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function isPlaceholderPath(path: string): boolean {
	const normalized = path.trim().toLowerCase();
	return normalized === "..." || normalized.includes("<path>") || normalized.includes("your/path");
}

function stripWrapping(value: string): string {
	const trimmed = value.trim();
	const backtickWrapped = /^`(.+)`$/.exec(trimmed);
	if (backtickWrapped?.[1]) {
		return backtickWrapped[1].trim();
	}
	const quoteWrapped = /^["'](.+)["']$/.exec(trimmed);
	if (quoteWrapped?.[1]) {
		return quoteWrapped[1].trim();
	}
	return trimmed;
}

function sanitizeAssistantText(text: string): string {
	let normalized = text.replace(/\[\[[a-z_]+:\s*[^\]]*]]/gi, "");
	normalized = normalized.replace(/@(?:image|voice|video|file):[a-zA-Z0-9_.-]+/g, "");
	normalized = normalized.replace(/\n{3,}/g, "\n\n");
	return normalized.trim();
}

function isSendFileFragmentLine(line: string, options: { allowLooseAngle: boolean }): boolean {
	if (!line) {
		return false;
	}
	return (
		/^<\s*\/?\s*send(?:[_\s-]?file)?(?:\b|$)/i.test(line) ||
		/^<\/\s*send(?:[_\s-]?file)?\s*>$/i.test(line) ||
		/^(?:path|title)\s*=/i.test(line) ||
		/^\/?>$/.test(line) ||
		/^<\/\s*$/.test(line) ||
		(options.allowLooseAngle && /^<\s*$/.test(line))
	);
}
