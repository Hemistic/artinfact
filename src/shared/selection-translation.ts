export const TRANSLATION_TARGET_CODES = ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'ar', 'hi', 'vi', 'th'] as const;
export const TRANSLATION_TARGET_NAMES = ['简体中文', '繁体中文', '英语', '日语', '韩语', '法语', '德语', '西班牙语', '葡萄牙语', '俄语', '意大利语', '阿拉伯语', '印地语', '越南语', '泰语'] as const;
export type TranslationPreferences = { enabled: boolean; provider: 'bing' | 'google'; target: typeof TRANSLATION_TARGET_CODES[number] };
export const DEFAULT_TRANSLATION_PREFERENCES: TranslationPreferences = { enabled: false, provider: 'bing', target: 'zh-Hans' };
type ReaderLookup = (payload: object, options?: object) => Promise<object>;
export function createSelectionTranslatorMemo() {
  let key = '', original: ReaderLookup | undefined, translator: ReaderLookup | null = null;
  return (lookup: ReaderLookup, settings: { selectionTranslationEnabled?: boolean; selectionTranslationProvider?: string; translationTarget?: string; theme?: string }) => {
    const next = JSON.stringify([settings.selectionTranslationEnabled, settings.selectionTranslationProvider, settings.translationTarget]);
    if (next !== key || original !== lookup) { key = next; original = lookup; translator = settings.selectionTranslationEnabled ? (payload, options) => lookup(payload, options) : null; }
    return translator;
  };
}
export type TranslationResult = {
  type: 'dictionary' | 'translation'; mode: 'dictionary' | 'translation'; provider: 'bing' | 'google';
  inputText: string; normalizedText: string; headword?: string; phonetics?: { us?: string; uk?: string; pronunciation?: string };
  meanings?: { pos: string; definition: string }[]; translatedText?: string; from?: string; to?: string;
};
export async function replyToSelectionLookup(
  payload: unknown, translate: (text: string) => Promise<object>, isCurrent: () => boolean, reply: (payload: object) => void,
) {
  const value = payload as { requestId?: unknown; request?: { text?: unknown } } | null;
  if (!value || typeof value.requestId !== 'string' || value.requestId.length > 160) return;
  const requestId = value.requestId;
  try {
    if (typeof value.request?.text !== 'string' || !value.request.text.trim() || value.request.text.length > 12000) throw new Error('请选择 1–12000 个字符进行翻译');
    const result = await translate(value.request.text);
    if (isCurrent()) reply({ requestId, result });
  } catch (error) {
    if (isCurrent()) reply({ requestId, error: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
  }
}
