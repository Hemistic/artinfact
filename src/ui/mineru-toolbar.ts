import { dropdownPosition } from '../shared/dropdown-layout.js';
import { combinedMineruProgress } from '../shared/mineru-progress.js';
import type {LocalProcessorStatus} from '../shared/local-processor.js';
import type { AnalysisStatus } from '../shared/mineru.js';
import type { LayoutStatus } from '../shared/layout-status.js';
import { readerAnalysisMenu } from '../shared/reader-menu.js';
import { readerIcon, setControlIcon } from './icons.js';

type ReactApi = {
  createElement(type: string | (() => unknown), props: object | null, ...children: unknown[]): unknown;
  useState<T>(initial: T): [T, (value: T) => void];
  useEffect(effect: () => (() => void), dependencies: unknown[]): void;
};
type ToolbarWindow = Window & { __codexAnalysisButton?: (react: ReactApi) => unknown };
export function installMineruToolbar(target: Window, report: (type: string, payload: object) => void) {
  const doc = target.document; let progress = combinedMineruProgress(); let status: AnalysisStatus | undefined, layout: LayoutStatus | undefined,processor:LocalProcessorStatus|undefined; let menu: HTMLDivElement | undefined; let component: (() => unknown) | undefined;
  const listeners = new Set<() => void>(); const publish = () => { for (const listener of listeners) listener(); };
  const snapshot = () => ({ ...progress, expanded: !!menu });
  function hide(focus = false) { if (!menu) return; menu.remove(); menu = undefined; publish(); if (focus) doc.getElementById('codexAnalysis')?.focus(); }
  function renderMenu() {
    if (!menu) return; const focused = (doc.activeElement as HTMLElement | null)?.dataset.action;
    menu.replaceChildren();
    const model = readerAnalysisMenu(status, layout);
    const actions = [['convert', model.convertLabel, model.convertDisabled, 'refresh'], ['layout', model.layoutLabel, model.layoutDisabled, 'layout']] as const;
    for (const [action, label, disabled, icon] of actions) {
      const item = doc.createElement('button'); item.type = 'button'; item.role = 'menuitem'; item.textContent = label; item.disabled = disabled; item.dataset.action = action;
      setControlIcon(item, icon);
      if (action === 'convert') item.title = '使用独立安装的 MinerU 标准处理器，同时生成内部 Markdown、JSON 和布局；PDF 不上传云端';
      else if (action === 'layout') { item.title = model.layoutTitle; const detail = doc.createElement('small'); detail.className = 'codex-mineru-menu-detail'; detail.textContent = model.layoutDetail; item.append(detail); }
      item.onclick = () => { const rect = doc.getElementById('codexAnalysis')!.getBoundingClientRect(); hide(); report('codex-reader:analysis-action', { action, anchor: { left: rect.left, right: rect.right, bottom: rect.bottom } }); }; menu.append(item);
      if (action === 'convert') {
        const row = doc.createElement('div'); row.className = 'codex-mineru-menu-status with-icon'; row.role = 'menuitem'; row.setAttribute('aria-disabled', 'true'); row.setAttribute('aria-live', 'polite'); row.textContent = progress.busy ? progress.label : model.statusLabel; row.title = progress.label; row.dataset.state = progress.state;
        setControlIcon(row, progress.state === 'completed' ? 'check' : progress.state === 'failed' ? 'alert' : 'more'); menu.append(row);
      }
      if (focused === action && !disabled) item.focus();
    }
  }
  function toggle() {
    if (menu) { hide(true); return; } const button = doc.getElementById('codexAnalysis'); if (!button) return;
    const rect = button.getBoundingClientRect(); menu = doc.createElement('div'); menu.className = 'codex-mineru-menu'; menu.id = 'codex-mineru-menu'; menu.role = 'menu'; menu.setAttribute('aria-label', '转换与布局解析');
    const placement = dropdownPosition(rect, { width: target.innerWidth, height: target.innerHeight });
    Object.assign(menu.style, { left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, maxHeight: `${placement.maxHeight}px` });
    doc.body.append(menu); renderMenu(); publish(); menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    menu.onkeydown = event => {
      const items = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = items.indexOf(doc.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }
      else if (event.key === 'Tab') hide();
    };
  }
  doc.addEventListener('pointerdown', event => { const node = event.target as Node | null; if (menu && node && !menu.contains(node) && !doc.getElementById('codexAnalysis')?.contains(node)) hide(); }, true);
  target.addEventListener('blur', () => hide()); target.addEventListener('resize', () => hide());
  (target as ToolbarWindow).__codexAnalysisButton = react => {
    if (!component) component = () => {
      const [state, update] = react.useState(snapshot());
      react.useEffect(() => { const listener = () => update(snapshot()); listeners.add(listener); listener(); return () => { listeners.delete(listener); }; }, []);
      return react.createElement('button', { id: 'codexAnalysis', type: 'button', className: 'toolbar-button codex-mineru-button', title: `${state.label} · 点击打开菜单`, 'aria-label': state.label, 'aria-haspopup': 'menu', 'aria-expanded': state.expanded, 'aria-controls': state.expanded ? 'codex-mineru-menu' : undefined, 'aria-busy': state.busy, 'data-state': state.state, tabIndex: -1, onClick: toggle },
        react.createElement('span', { className: `codex-mineru-ring${state.indeterminate ? ' indeterminate' : ''}`, style: { '--mineru-progress': `${state.percent ?? 0}%` }, role: state.busy ? 'progressbar' : undefined, 'aria-label': state.busy ? state.label : undefined, 'aria-valuemin': state.busy ? 0 : undefined, 'aria-valuemax': state.busy ? 100 : undefined, 'aria-valuenow': state.busy && state.percent !== null ? state.percent : undefined },
          react.createElement('span', { className: 'codex-mineru-ring-value', 'aria-hidden': true }, state.state === 'completed' ? readerIcon(react, 'check', 11) : state.state === 'failed' ? readerIcon(react, 'alert', 11) : state.percent === null ? state.shortLabel : String(state.percent))));
    };
    return react.createElement(component, null);
  };
  let lastProgress='';
  const refresh=()=>{const signature=JSON.stringify([status,layout,processor]);if(signature===lastProgress)return;lastProgress=signature;progress=combinedMineruProgress(status,layout,processor);renderMenu();publish();};
  return { update(value?: AnalysisStatus) { status = value; refresh(); }, updateLayout(value?: LayoutStatus) { layout = value; refresh(); },updateProcessor(value?:LocalProcessorStatus){processor=value;refresh();} };
}
