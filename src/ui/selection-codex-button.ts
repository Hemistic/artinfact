import { readerIcon } from './icons.js';

type ReactFactory = Parameters<typeof readerIcon>[0];
type Annotation = { text?: string; position?: { pageIndex?: number } };
type ButtonWindow = { __codexTranslateButton?: (react: ReactFactory, annotation?: Annotation) => unknown };
export function installCodexTranslationButton(target: ButtonWindow, report: (type: string, payload: object) => void) {
  target.__codexTranslateButton = (react, annotation) => react.createElement('button', {
    type: 'button', className: 'toolbar-button wide-button with-icon codex-selection-translate', 'data-tabstop': 1,
    title: '将选文交给 Codex 翻译，译文显示在聊天中', 'aria-label': '用 Codex 翻译', disabled: !annotation?.text?.trim(),
    onClick: () => report('codex-reader:translate-with-codex', { text: annotation?.text, pageIndex: annotation?.position?.pageIndex }),
  }, readerIcon(react, 'translate', 16), '用 Codex 翻译');
}
