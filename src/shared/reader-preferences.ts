export type ReaderMode = 'light' | 'dark';
export type ReaderAppearance = { scheme: ReaderMode; paper?: ReaderMode };
export function normalizeAppearance(value: unknown): ReaderAppearance | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<ReaderAppearance>;
  if (input.scheme !== 'light' && input.scheme !== 'dark') return null;
  return { scheme: input.scheme, ...(input.paper === 'light' || input.paper === 'dark' ? { paper: input.paper } : {}) };
}
export function effectiveAppearance(host: ReaderMode, preference: ReaderAppearance | null) {
  const scheme = preference?.scheme ?? host;
  return { scheme, paper: preference?.paper ?? scheme };
}
