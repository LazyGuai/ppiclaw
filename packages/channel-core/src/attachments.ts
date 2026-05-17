export function sanitizeFilename(filename: string): string {
	return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function createAttachmentFilename(messageId: string, filename: string): string {
	return `${sanitizeFilename(messageId)}_${sanitizeFilename(filename)}`;
}
