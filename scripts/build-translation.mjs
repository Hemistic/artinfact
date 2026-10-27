import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = await readFile('vendor/selection-translation/source/selection-translation-service.mjs', 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Original translation service changed: ${start}`);
  return source.slice(a, b);
};
// Reuse the original Bing session/dictionary/normalization code without its LLM or CLI runners.
let code = section('const DEFAULT_HEADERS', 'function parseArgs(')
  + section('function extractSingle(', 'function emitTranslationDelta(')
  + section('let cachedBingSession =', 'function extractClaudeText(')
  + '\nexport { looksLikeWordOrPhrase };\n';
// Keep the timeout active through the response body, including a stalled upstream stream.
code = code.replace('signal: options.signal || controller.signal,', 'signal: options.signal || AbortSignal.timeout(timeoutMs),');
await mkdir('vendor/selection-translation/runtime', { recursive: true });
await build({ stdin: { contents: code, resolveDir: process.cwd(), sourcefile: 'selection-translation-core.mjs' }, bundle: true, outfile: 'vendor/selection-translation/runtime/core.cjs', platform: 'node', target: 'node22', format: 'cjs', minify: true, legalComments: 'none' });
await writeFile('vendor/selection-translation/PROVENANCE.md', 'Bing dictionary, session refresh, citation normalization and translation are migrated from the user-owned PDF AI selection-translation-service.mjs. The complete original snapshot is in source/. scripts/build-translation.mjs extracts its Bing-only core; the TypeScript adapter implements provider settings, Google translation, length limits, cache and the Codex MCP bridge. No LLM/CLI runners are used.\n');
