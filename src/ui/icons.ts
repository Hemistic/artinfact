import { ArrowRight, ArrowLeft, BookOpen, Check, ChevronRight, CircleAlert, ClipboardCopy, Copy, Download, FileInput, FileText, FileX, FolderOpen, GitCompareArrows, Globe, House, Languages, LayoutPanelLeft, Moon, Sun, MoreHorizontal, Network, NotebookPen, Plus, Quote, RefreshCw, Save, Settings, Terminal, Trash2, Upload, X, type IconNode } from 'lucide';

// Import the official nodes individually so the bundle includes only the icons in use.
export const uiIcons = { lightTheme: Sun, darkTheme: Moon, translate: Languages, layout: LayoutPanelLeft, file: FileText, browser: Globe, terminal: Terminal, review: GitCompareArrows, plus: Plus, save: Save, arrow: ArrowRight, back: ArrowLeft, trash: Trash2, refresh: RefreshCw, copy: Copy, check: Check, folder: FolderOpen, settings: Settings, notes: NotebookPen, home: House, close: X, more: MoreHorizontal, graph: Network, book: BookOpen, download: Download, upload: Upload, fileInput: FileInput, fileClose: FileX, clipboard: ClipboardCopy, quote: Quote, chevron: ChevronRight, alert: CircleAlert } satisfies Record<string, IconNode>;
export type UiIcon = keyof typeof uiIcons;
const escapeAttribute = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function iconMarkup(name: UiIcon, className = '') {
  const nodes = uiIcons[name].map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${escapeAttribute(v!)}"`).join(' ')}></${tag}>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="icon ui-icon ${escapeAttribute(className)}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="${name}">${nodes}</svg>`;
}
export function setControlIcon(element: HTMLElement, name: UiIcon, keepLabel = true) {
  const label = keepLabel ? element.textContent ?? '' : '';
  if (!keepLabel) element.setAttribute('aria-label', element.getAttribute('aria-label') || element.title || name);
  element.innerHTML = iconMarkup(name);
  if (label) { const span = element.ownerDocument.createElement('span'); span.textContent = label; element.append(span); }
  element.classList.add('with-icon');
}
export function readerIcon(react: { createElement(type: string, props: object | null, ...children: unknown[]): unknown }, name: UiIcon, size = 20) {
  return react.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false, 'data-icon': name }, ...uiIcons[name].map(([tag, attrs], index) => react.createElement(tag, { ...attrs, key: index })));
}

