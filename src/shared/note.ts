export function noteTitle(text: string): string { return text.split(/\r?\n/, 1)[0]!.trim() || '无标题便签'; }
