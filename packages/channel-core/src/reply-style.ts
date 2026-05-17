export interface OpenClawReplyInput {
	answer: string;
	question?: string;
	maxTitleLength?: number;
	maxQuestionLength?: number;
	maxMarkdownLength?: number;
}

export interface OpenClawReplyPayload {
	title: string;
	markdown: string;
	plainText: string;
}

const DEFAULT_MAX_MARKDOWN_LENGTH = 9000;
const DEFAULT_MAX_QUESTION_LENGTH = 800;
const DEFAULT_MAX_TITLE_LENGTH = 60;

export function buildOpenClawReply(input: OpenClawReplyInput): OpenClawReplyPayload {
	const maxTitleLength = input.maxTitleLength ?? DEFAULT_MAX_TITLE_LENGTH;
	const maxQuestionLength = input.maxQuestionLength ?? DEFAULT_MAX_QUESTION_LENGTH;
	const maxMarkdownLength = input.maxMarkdownLength ?? DEFAULT_MAX_MARKDOWN_LENGTH;

	const normalizedAnswer = normalize(input.answer) || "(empty response)";
	const normalizedQuestion = normalize(input.question ?? "");
	const shortQuestion = truncate(normalizedQuestion, maxQuestionLength);

	const titleSource = shortQuestion || normalizedAnswer;
	const title = deriveTitle(titleSource, maxTitleLength);

	const markdown = truncate(
		shortQuestion ? `${toMarkdownQuote(shortQuestion)}\n\n---\n\n${normalizedAnswer}` : normalizedAnswer,
		maxMarkdownLength,
	);

	const plainText = shortQuestion
		? `Original question:\n${shortQuestion}\n\nAnswer:\n${normalizedAnswer}`
		: normalizedAnswer;

	return {
		title,
		markdown,
		plainText,
	};
}

function normalize(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, Math.max(0, maxLength - 13)).trimEnd()}\n\n[message cut]`;
}

function toMarkdownQuote(text: string): string {
	return text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

function deriveTitle(text: string, maxTitleLength: number): string {
	const firstLine =
		text
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? "pi-mono";
	const cleaned =
		firstLine
			.replace(/^#{1,6}\s*/, "")
			.replace(/[*_`~[\]]/g, "")
			.trim() || "pi-mono";
	if (cleaned.length <= maxTitleLength) {
		return cleaned;
	}
	return `${cleaned.slice(0, Math.max(0, maxTitleLength - 3))}...`;
}
