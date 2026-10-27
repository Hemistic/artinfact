export const MENU_WIDTH = 248;
export type MenuAnchor = { left: number; right: number; bottom: number };
export function dropdownPosition(anchor: MenuAnchor, viewport: { width: number; height: number }, align: 'left' | 'right' = 'left') {
  const width = Math.min(MENU_WIDTH, Math.max(0, viewport.width - 16));
  const left = Math.max(8, Math.min(align === 'right' ? anchor.right - width : anchor.left, viewport.width - width - 8));
  const top = Math.max(8, Math.min(anchor.bottom + 6, viewport.height - 40));
  return { left, top, width, maxHeight: Math.max(0, viewport.height - top - 8) };
}
