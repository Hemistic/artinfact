export type GraphPreferences = {
 spacing: .75 | 1 | 1.35;
 rebound: 'soft' | 'standard';
 labels: boolean;
 fontSize: 11 | 13 | 16;
};
const storageKey = 'artinfact.graph-preferences.v1';
export function normalizeGraphPreferences(value: unknown): GraphPreferences {
 const source = value && typeof value === 'object' ? value as Partial<GraphPreferences> : {};
 return {
  spacing: source.spacing === .75 || source.spacing === 1.35 ? source.spacing : 1,
  rebound: source.rebound === 'standard' ? 'standard' : 'soft',
  labels: source.labels !== false,
  fontSize: source.fontSize === 13 || source.fontSize === 16 ? source.fontSize : 11,
 };
}
export function readGraphPreferences(): GraphPreferences {
 try { return normalizeGraphPreferences(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
 catch { return normalizeGraphPreferences(null); }
}
export function saveGraphPreferences(value: GraphPreferences) {
 try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
}
