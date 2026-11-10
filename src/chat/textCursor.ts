export function insertAtCursor(
  text: string,
  insert: string,
  selectionStart: number,
  selectionEnd: number,
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  return {
    text: `${text.slice(0, start)}${insert}${text.slice(end)}`,
    caret: start + insert.length,
  };
}
