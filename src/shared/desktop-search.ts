// Fold only English letters so character offsets stay identical for the highlighted original name.
export function searchText(value: string): string {
  return value.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

export function resultLayout(width: number, count: number, desktopIconSize: number) {
  // DIP dimensions mirror grid padding/gaps, reserving two label lines and at most three visible rows.
  const iconSize = Math.min(desktopIconSize, width - 56);
  const cellWidth = Math.max(82, iconSize + 24);
  const columns = Math.max(1, Math.floor((width - 30 + 8) / (cellWidth + 8)));
  const rows = Math.min(3, Math.ceil(count / columns));
  const rowHeight = iconSize + 68;
  return { iconSize, columns, rowHeight, panelHeight: rows ? 26 + rows * rowHeight + (rows - 1) * 8 : 0 };
}

export function nameParts(name: string, query: string): { text: string; matched: boolean }[] {
  const needle = searchText(query.trim());
  if (!needle) return [{ text: name, matched: false }];
  const lower = searchText(name);
  const parts: { text: string; matched: boolean }[] = [];
  let offset = 0;
  while (offset < name.length) {
    const index = lower.indexOf(needle, offset);
    if (index < 0) { parts.push({ text: name.slice(offset), matched: false });break; }
    if (index > offset) parts.push({ text: name.slice(offset, index), matched: false });
    parts.push({ text: name.slice(index, index + needle.length), matched: true });
    offset = index + needle.length;
  }
  return parts;
}
