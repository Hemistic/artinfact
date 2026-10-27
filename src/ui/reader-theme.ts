import { effectiveAppearance, normalizeAppearance, type ReaderAppearance } from '../shared/reader-preferences.js';
export type ReaderScheme = 'light' | 'dark';
export type ReaderPalette = { scheme: ReaderScheme; background: string; secondary: string; text: string; muted: string; border: string; accent: string; hover: string };
export type ReaderTheme = { id: string; label: string; background: string; foreground: string; invertImages?: boolean };
export const GPT_PALETTES: Record<ReaderScheme, ReaderPalette> = {
  light: { scheme: 'light', background: '#ffffff', secondary: '#f5f5f5', text: '#1a1c1f', muted: '#707070', border: '#e5e5e5', accent: '#339cff', hover: '#ededed' },
  dark: { scheme: 'dark', background: '#181818', secondary: '#242424', text: '#ffffff', muted: '#a0a0a0', border: '#383838', accent: '#83c3ff', hover: '#2a2a2a' },
};
export const GPT_THEMES: ReaderTheme[] = [
  { id: 'gpt-light', label: '白天', background: GPT_PALETTES.light.background, foreground: GPT_PALETTES.light.text },
  { id: 'gpt-dark', label: '黑夜', background: GPT_PALETTES.dark.background, foreground: GPT_PALETTES.dark.text },
];
export function normalizeReaderPalette(value: unknown): ReaderPalette {
  const input = value && typeof value === 'object' ? value as Partial<ReaderPalette> : {};
  const scheme = input.scheme === 'dark' ? 'dark' : 'light';
  const result = { ...GPT_PALETTES[scheme] };
  for (const key of ['background', 'secondary', 'text', 'muted', 'border', 'accent', 'hover'] as const) {
    const color = input[key]; if (typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color)) result[key] = color.toLowerCase();
  }
  return result;
}
export function readHostReaderPalette(doc: Document): ReaderPalette {
  const scheme: ReaderScheme = doc.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const defaults = GPT_PALETTES[scheme];
  const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return { ...defaults };
  const probe = doc.createElement('span'); probe.hidden = true; doc.body.append(probe);
  const color = (token: string, fallback: string) => {
    probe.style.color = `var(${token}, ${fallback})`;
    const resolved = doc.defaultView!.getComputedStyle(probe).color;
    context.clearRect(0, 0, 1, 1); context.fillStyle = defaults.background; context.fillRect(0, 0, 1, 1);
    context.fillStyle = resolved; context.fillRect(0, 0, 1, 1);
    return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
  };
  try { return { scheme, background: color('--color-background-primary', defaults.background), secondary: color('--color-background-secondary', defaults.secondary), text: color('--color-text-primary', defaults.text), muted: color('--color-text-secondary', defaults.muted), border: color('--color-border-secondary', defaults.border), accent: color('--color-text-info', defaults.accent), hover: color('--color-background-tertiary', defaults.hover) }; }
  finally { probe.remove(); }
}
type ThemeReader = { _state?: { lightTheme?: ReaderTheme; darkTheme?: ReaderTheme; colorScheme?: ReaderScheme }; setLightTheme(id?: string): void; setDarkTheme(id?: string): void; setColorScheme(scheme: ReaderScheme): void };
type ReactFactory = { createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown };
export type ThemedReaderWindow = Window & { _reader?: ThemeReader; __codexPost?: (message: object) => void; __CODEX_GPT_THEMES__?: ReaderTheme[]; __CODEX_BUILTIN_THEMES__?: ReaderTheme[]; __codexThemeControls?: (react: ReactFactory) => unknown; __codexSelectTheme?: (id?: string) => boolean; __codexSyncHostTheme?: () => void };
export function installReaderThemes(win: ThemedReaderWindow) {
  const palettes = { light: { ...GPT_PALETTES.light }, dark: { ...GPT_PALETTES.dark } };
  let scheme: ReaderScheme = 'light';
  let hostScheme: ReaderScheme = 'light';
  let appearance: ReaderAppearance | null = null;
  win.__CODEX_GPT_THEMES__ = GPT_THEMES.map(theme => ({ ...theme }));
  const chrome = (doc: Document) => {
    const p = scheme === hostScheme ? palettes[scheme] : GPT_PALETTES[scheme]; const style = doc.documentElement.style;
    doc.documentElement.dataset.gptReader = 'true';
    const colors: Record<string, string> = {
      '--gpt-reader-background': p.background, '--gpt-reader-text': p.text,
      '--color-background': p.background, '--color-background50': p.background + '80', '--color-background70': p.background + 'b2',
      '--color-button': p.background, '--color-button50': p.background + '80', '--color-control': p.secondary,
      '--color-menu': p.background, '--color-sidepane': p.background, '--color-toolbar': p.background, '--color-tabbar': p.background,
      '--color-border': p.border, '--color-border50': p.border + '80', '--color-panedivider': p.border,
      '--fill-primary': p.text, '--fill-secondary': p.muted, '--fill-tertiary': p.muted + '99', '--fill-quarternary': p.border,
      '--fill-quinary': p.hover, '--fill-senary': p.hover + '80', '--color-quinary-on-background': p.hover,
      '--color-quarternary-on-background': p.secondary, '--color-quarternary-on-sidepane': p.secondary,
      '--accent-blue': p.accent, '--accent-blue10': p.accent + '1a', '--accent-blue30': p.accent + '4d', '--accent-blue50': p.accent + '80',
      '--color-scrollbar': p.muted + '80', '--color-scrollbar-hover': p.muted,
    };
    for (const [name, value] of Object.entries(colors)) if(style.getPropertyValue(name)!==value)style.setProperty(name, value);
  };
  const chromeAll = () => { chrome(win.document); for (const frame of win.document.querySelectorAll('iframe')) if (frame.contentDocument) chrome(frame.contentDocument); };
  const themeDefinitions = () => {
    const effective = effectiveAppearance(hostScheme, appearance); scheme = effective.scheme;
    const page = effective.paper === hostScheme ? palettes[effective.paper] : GPT_PALETTES[effective.paper]; const themes = win.__CODEX_BUILTIN_THEMES__ ?? win.__CODEX_GPT_THEMES__!;
    for (let index = 0; index < themes.length; index++) {
      const theme = themes[index];
      // Keep object identity when colors are unchanged; Reader uses it to detect repainting.
      if (theme.background !== page.background || theme.foreground !== page.text) themes[index] = { ...theme, background: page.background, foreground: page.text };
    }
    return themes;
  };
  const updateSettings = (settings: { gptPalette?: unknown; appearance?: unknown }) => {
    if (settings.gptPalette) { const palette = normalizeReaderPalette(settings.gptPalette); hostScheme = palette.scheme; palettes[hostScheme] = palette; }
    if (Object.hasOwn(settings, 'appearance')) appearance = normalizeAppearance(settings.appearance);
    themeDefinitions(); chromeAll();
  };
  const syncHost = () => {
    const themes = themeDefinitions(); const reader = win._reader; if (!reader) return;
    if (reader._state?.lightTheme !== themes[0]) reader.setLightTheme('gpt-light');
    if (reader._state?.darkTheme !== themes[1]) reader.setDarkTheme('gpt-dark');
    if (reader._state?.colorScheme !== scheme) reader.setColorScheme(scheme);
    chromeAll();
  };
  const choose = (value: ReaderAppearance) => { appearance = value; syncHost(); win.__codexPost?.({ type: 'codex-reader:appearance-change', payload: value }); };
  win.__codexSyncHostTheme = syncHost;
  win.__codexSelectTheme = id => {
    if (!win._reader || (id !== 'gpt-light' && id !== 'gpt-dark')) return false;
    choose({ scheme: id === 'gpt-dark' ? 'dark' : 'light', ...(appearance?.paper ? { paper: appearance.paper } : {}) }); return true;
  };
  win.__codexThemeControls = react => {
    const effective = effectiveAppearance(hostScheme, appearance);
    const button = (mode: ReaderScheme, paper = false) => react.createElement('button', { type: 'button', tabIndex: -1, 'aria-pressed': (paper ? effective.paper : effective.scheme) === mode, title: paper ? (mode === 'light' ? '白色纸面' : '黑色纸面') : (mode === 'light' ? '白天' : '黑夜'), onClick: () => paper ? choose({ scheme: effectiveAppearance(hostScheme, appearance).scheme, paper: mode }) : win.__codexSelectTheme?.(`gpt-${mode}`) }, paper ? (mode === 'light' ? '白色' : '黑色') : (mode === 'light' ? '白天' : '黑夜'));
    return react.createElement('div', { className: 'gpt-appearance' }, react.createElement('label', null, '界面主题'), react.createElement('div', { className: 'gpt-choices', 'data-tabstop': 1 }, button('light'), button('dark')), react.createElement('label', null, 'PDF 纸面颜色'), react.createElement('div', { className: 'gpt-choices', 'data-tabstop': 1 }, button('light', true), button('dark', true)), react.createElement('p', null, '纸面颜色独立设置，批注颜色保持不变。'));
  };
  const observer = new MutationObserver(chromeAll);
  observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
  win.document.addEventListener('load', event => { if (event.target instanceof HTMLIFrameElement && event.target.contentDocument) chrome(event.target.contentDocument); }, true);
  return { updateSettings, syncHost };
}
