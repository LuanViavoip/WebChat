export function panelSize(open: boolean): { width: number; height: number } {
  if (!open) return { width: 72, height: 72 };
  return { width: 380, height: 640 };
}
