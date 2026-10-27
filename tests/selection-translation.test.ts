import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SelectionTranslationService, TranslationPreferencesStore, splitTranslationText, parseGoogleTranslation, parseGoogleDictionary } from '../src/server/selection-translation.ts';
import { replyToSelectionLookup, createSelectionTranslatorMemo } from '../src/shared/selection-translation.ts';

test('provider changes retranslate an open popup; host/theme notifications keep the translator stable', () => {
  const memo = createSelectionTranslatorMemo(); const lookup = async () => ({});
  const settings = { selectionTranslationEnabled: true, selectionTranslationProvider: 'bing', translationTarget: 'zh-Hans' };
  const initial = memo(lookup, settings);
  assert.equal(memo(lookup, { ...settings, theme: 'dark' }), initial);
  assert.notEqual(memo(lookup, { ...settings, selectionTranslationProvider: 'google' }), initial);
  assert.equal(memo(lookup, { ...settings, selectionTranslationEnabled: false }), null);
});

test('translation preferences persist independently of reader appearance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-translate-'));
  const store = new TranslationPreferencesStore(root);
  assert.deepEqual(await store.read(), { enabled: true, provider: 'bing', target: 'zh-Hans' });
  await store.write({ enabled: false, provider: 'google', target: 'en' });
  assert.deepEqual(await new TranslationPreferencesStore(root).read(), { enabled: false, provider: 'google', target: 'en' });
  assert.doesNotMatch(await readFile(join(root, 'translation-preferences.json'), 'utf8'), /appearance/);
  await assert.rejects(() => store.write({ enabled: true, provider: 'invalid' as 'bing', target: 'en' }));
});

test('long selections split without truncation and Google response joins all segments', () => {
  const text = 'A long sentence. '.repeat(200) + '😀 Last sentence.';
  const chunks = splitTranslationText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(c => c.length <= 900 && !/[\uD800-\uDBFF]$/.test(c)));
  assert.equal(parseGoogleTranslation([[['第一句。', 'One'], ['第二句。', 'Two']]]), '第一句。第二句。');
  assert.throws(() => parseGoogleTranslation([[]]), /翻译/);
});

test('migrated Bing dictionary strips citations, deduplicates requests, and returns only popup fields', async () => {
  let lookups = 0;
  const service = new SelectionTranslationService({
    dictionary: async query => { lookups++; return { found: true, headword: query, phonetics: { us: 'ˈnjuːrəl' }, meanings: [{ pos: 'adj.', definition: '神经的' }], debug: { token: 'secret' } }; },
    bing: async () => { throw new Error('dictionary should not call MT'); },
    google: async () => '谷歌译文',
  });
  const [a, b] = await Promise.all([service.translate('neural [12]', { provider: 'bing', target: 'zh-Hans' }), service.translate('neural [12]', { provider: 'bing', target: 'zh-Hans' })]);
  assert.equal(lookups, 1); assert.deepEqual(a, b);
  assert.equal(a.mode, 'dictionary'); assert.equal(a.headword, 'neural');
  assert.doesNotMatch(JSON.stringify(a), /secret|debug|endpoint/);
});

test('sentences, target changes and missing dictionaries use MT; Google never uses Bing', async () => {
  const calls: string[] = [];
  const service = new SelectionTranslationService({ dictionary: async () => ({ found: false }), bing: async (text, target) => { calls.push(`bing:${target}:${text}`); return '句子译文'; }, google: async (text, target) => { calls.push(`google:${target}:${text}`); return '谷歌译文'; } });
  assert.equal((await service.translate('This is a sentence.', { provider: 'bing', target: 'zh-Hans' })).translatedText, '句子译文');
  assert.equal((await service.translate('neural', { provider: 'bing', target: 'en' })).mode, 'translation');
  assert.equal((await service.translate('neural', { provider: 'google', target: 'zh-Hans' })).provider, 'google');
  assert.equal(calls.length, 3); assert.match(calls[2], /^google:/);
  await assert.rejects(() => service.translate('x'.repeat(12001), { provider: 'bing', target: 'en' }), /12000/);
});

test('Google dictionary preserves parts of speech, translated senses and source pronunciation', async () => {
  const value = [[['苹果', 'apple'], [null, null, 'Píngguǒ', 'ˈap(ə)l']], [['noun', ['苹果', '苹']]], 'en'];
  const dictionary = parseGoogleDictionary(value, 'apple', 'zh-Hans');
  assert.equal(dictionary.found, true); assert.deepEqual(dictionary.meanings, [{ pos: 'noun', definition: '苹果；苹' }]);
  assert.equal(dictionary.phonetics?.pronunciation, 'ˈap(ə)l');
  const service = new SelectionTranslationService({ dictionary: async () => { throw Error('must not call Bing'); }, bing: async () => { throw Error('must not call Bing'); }, google: async () => 'fallback', googleDictionary: async () => dictionary });
  const result = await service.translate('apple', { provider: 'google', target: 'zh-Hans' });
  assert.equal(result.mode, 'dictionary'); assert.equal(result.provider, 'google'); assert.equal(result.phonetics?.pronunciation, 'ˈap(ə)l');
  assert.equal(parseGoogleDictionary([[], null], 'unknown', 'ja').found, false);
});

test('all displayed target languages are accepted and persisted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artinfact-targets-')); const store = new TranslationPreferencesStore(root);
  for (const target of ['zh-Hant', 'ko', 'fr', 'de', 'es', 'ru', 'ar'] as const) { await store.write({ enabled: true, provider: 'google', target }); assert.equal((await store.read()).target, target); }
});

test('selection lookup replies retain request ID, report errors, and never reach replaced frames', async () => {
  let live = true; const replies: object[] = [];
  let resolve!: (value: object) => void;
  const pending = replyToSelectionLookup({ requestId: 'first', request: { text: 'old' } }, () => new Promise(r => { resolve = r; }), () => live, value => replies.push(value));
  live = false; resolve({ translatedText: 'old result' }); await pending; assert.equal(replies.length, 0);
  live = true;
  await replyToSelectionLookup({ requestId: 'second', request: { text: 'new' } }, async () => { throw new Error('网络失败'); }, () => live, value => replies.push(value));
  assert.deepEqual(replies, [{ requestId: 'second', error: '网络失败' }]);
});
