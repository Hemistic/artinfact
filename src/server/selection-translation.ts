import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { renameWithRetry } from './atomic-rename.js';
import { DEFAULT_TRANSLATION_PREFERENCES, TRANSLATION_TARGET_CODES, type TranslationPreferences, type TranslationResult } from '../shared/selection-translation.js';

export const TranslationPreferencesSchema = z.object({ enabled: z.boolean(), provider: z.enum(['bing', 'google']), target: z.enum(TRANSLATION_TARGET_CODES) });
export class TranslationPreferencesStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private root: string) {}
  async read(): Promise<TranslationPreferences> {
    await this.pending.catch(() => undefined);
    try { return TranslationPreferencesSchema.parse(JSON.parse(await readFile(join(this.root, 'translation-preferences.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_TRANSLATION_PREFERENCES }; throw new Error('翻译设置读取失败，已保留原文件'); }
  }
  async write(input: TranslationPreferences) {
    const value = TranslationPreferencesSchema.parse(input);
    const operation = this.pending.catch(() => undefined).then(async () => {
      await mkdir(this.root, { recursive: true }); const temporary = join(this.root, `translation.${randomUUID()}.tmp`);
      try { await writeFile(temporary, JSON.stringify(value)); await renameWithRetry(temporary, join(this.root, 'translation-preferences.json')); }
      finally { await unlink(temporary).catch(() => undefined); }
    });
    this.pending = operation; await operation; return value;
  }
}

type Dictionary = { found: boolean; headword?: string | null; phonetics?: { us?: string; uk?: string; pronunciation?: string }; meanings?: { pos?: string; definition?: string }[] };
type Engines = { dictionary(text: string): Promise<Dictionary>; googleDictionary?(text: string, target: string): Promise<Dictionary>; bing(text: string, target: string): Promise<string>; google(text: string, target: string): Promise<string> };
const require = createRequire(import.meta.url);
const core = require('../../vendor/selection-translation/runtime/core.cjs') as {
  normalizeSelectionInput(text: string): string;
  looksLikeWordOrPhrase(text: string): { normalized: string; isWordLike: boolean };
  lookupWordOrPhrase(text: string): Promise<Dictionary>;
  translateWithBing(input: { text: string; from: string; to: string }): Promise<{ translatedText: string }>;
};
export function splitTranslationText(text: string): string[] {
  const result: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 900, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    if (end < text.length) {
      const segment = text.slice(offset, end);
      const boundary = Math.max(segment.lastIndexOf('\n'), segment.lastIndexOf('. '), segment.lastIndexOf('。'), segment.lastIndexOf(' '));
      if (boundary > 450) end = offset + boundary + 1;
    }
    result.push(text.slice(offset, end)); offset = end;
  }
  return result;
}
export function parseGoogleTranslation(value: unknown): string {
  if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error('Google 返回了无效翻译');
  const translated = value[0].map((row: unknown) => Array.isArray(row) && typeof row[0] === 'string' ? row[0] : '').join('');
  if (!translated.trim()) throw new Error('Google 未返回翻译'); return translated;
}
export function parseGoogleDictionary(value: unknown, query: string, target: string): Dictionary {
  if (!Array.isArray(value)) return { found: false };
  const meanings: { pos: string; definition: string }[] = [];
  if (Array.isArray(value[1])) for (const group of value[1].slice(0, 20)) {
    if (!Array.isArray(group) || !Array.isArray(group[1])) continue;
    const definition = group[1].filter((v: unknown): v is string => typeof v === 'string').slice(0, 20).join('；').slice(0, 2000);
    if (definition) meanings.push({ pos: typeof group[0] === 'string' ? group[0].slice(0, 80) : '', definition });
  }
  // Google monolingual English definitions are only appropriate for an English target.
  if (!meanings.length && target === 'en' && Array.isArray(value[12])) for (const group of value[12].slice(0, 10)) {
    if (!Array.isArray(group) || !Array.isArray(group[1])) continue;
    for (const sense of group[1].slice(0, 10)) if (Array.isArray(sense) && typeof sense[0] === 'string') meanings.push({ pos: typeof group[0] === 'string' ? group[0].slice(0, 80) : '', definition: sense[0].slice(0, 2000) });
  }
  let pronunciation = '';
  if (Array.isArray(value[0])) for (const segment of value[0]) if (Array.isArray(segment) && segment[0] === null && typeof segment[3] === 'string') pronunciation = segment[3].slice(0, 160);
  return { found: !!meanings.length, headword: query, meanings, phonetics: { pronunciation } };
}
async function googleRequest(text: string, target: string, dictionary = false): Promise<unknown> {
  const language = target === 'zh-Hans' ? 'zh-CN' : target === 'zh-Hant' ? 'zh-TW' : target;
  const query = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: language, q: text });
  for (const dt of dictionary ? ['t', 'bd', 'md', 'rm'] : ['t']) query.append('dt', dt);
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Google 翻译请求失败（${response.status}）`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('Google 翻译响应为空');
  let bytes = 0; const chunks: Uint8Array[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error('Google 翻译响应过大'); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const defaultEngines: Engines = { dictionary: core.lookupWordOrPhrase, bing: async (text, target) => (await core.translateWithBing({ text, from: 'auto-detect', to: target })).translatedText, google: async (text, target) => parseGoogleTranslation(await googleRequest(text, target)), googleDictionary: async (text, target) => parseGoogleDictionary(await googleRequest(text, target, true), text, target) };
const clean = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
export class SelectionTranslationService {
  private cache = new Map<string, { expires: number; result: TranslationResult }>();
  private inflight = new Map<string, Promise<TranslationResult>>();
  constructor(private engines: Engines = defaultEngines) {}
  async translate(input: string, options: Pick<TranslationPreferences, 'provider' | 'target'>): Promise<TranslationResult> {
    if (!input.trim() || input.length > 12000) throw new Error('翻译选文长度须为 1–12000 个字符');
    const normalized = core.normalizeSelectionInput(input);
    const key = JSON.stringify([options.provider, options.target, normalized]);
    const cached = this.cache.get(key); if (cached && cached.expires > Date.now()) return structuredClone(cached.result);
    const pending = this.inflight.get(key); if (pending) return structuredClone(await pending);
    if (this.inflight.size >= 4) throw new Error('正在翻译其他选文，请稍后重试');
    const operation = this.lookup(input, normalized, options).then(result => {
      this.cache.delete(key); this.cache.set(key, { expires: Date.now() + 10 * 60 * 1000, result });
      while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!); return result;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, operation); return structuredClone(await operation);
  }
  private async lookup(input: string, normalized: string, { provider, target }: Pick<TranslationPreferences, 'provider' | 'target'>): Promise<TranslationResult> {
    const plan = core.looksLikeWordOrPhrase(input);
    // Bing dictionary is bilingual English/Chinese; other target languages go through translation.
    const dictionary = provider === 'google' && this.engines.googleDictionary ? () => this.engines.googleDictionary!(plan.normalized, target) : provider === 'bing' && target === 'zh-Hans' && /^[\x00-\x7F]+$/.test(plan.normalized) ? () => this.engines.dictionary(plan.normalized) : undefined;
    if (plan.isWordLike && dictionary) {
      try {
        const value = await dictionary();
        const meanings = (value.meanings ?? []).slice(0, 30).map(m => ({ pos: clean(m.pos, 80), definition: clean(m.definition, 2000) })).filter(m => m.definition);
        if (value.found && meanings.length) return { type: 'dictionary', mode: 'dictionary', provider, inputText: input, normalizedText: normalized, headword: clean(value.headword, 100) || plan.normalized, phonetics: { us: clean(value.phonetics?.us, 160), uk: clean(value.phonetics?.uk, 160), pronunciation: clean(value.phonetics?.pronunciation, 160) }, meanings };
      } catch { /* Missing dictionary/network: the original reader falls back to machine translation. */ }
    }
    const chunks = splitTranslationText(normalized);
    const values: string[] = new Array(chunks.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (next < chunks.length) { const index = next++; values[index] = await this.engines[provider](chunks[index]!, target); }
    }));
    const translatedText = values.join('\n').slice(0, 60000); if (!translatedText.trim()) throw new Error('翻译服务未返回译文');
    return { type: 'translation', mode: 'translation', provider, inputText: input, normalizedText: normalized, translatedText, from: 'auto', to: target };
  }
}
