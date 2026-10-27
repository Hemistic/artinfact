import {uiText} from '../ui/ui-language.js';
import {normalizeGraphPreferences, type GraphPreferences} from './graph-preferences.js';

export function renderGraphSettings(menu: HTMLElement, initial: GraphPreferences, change: (value: GraphPreferences) => void) {
 let preferences = initial;
 function control(key: keyof GraphPreferences, label: string, choices: Array<[string, string]>) {
  const row = document.createElement('label'); row.className = 'graph-setting-row';
  const caption = document.createElement('span'); caption.textContent = uiText(label);
  const select = document.createElement('select'); select.setAttribute('aria-label', uiText(label));
  for (const [value, title] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = uiText(title); select.append(option); }
  select.value = String(preferences[key]);
  select.onchange = () => {
   const value = key === 'labels' ? select.value === 'true' : key === 'rebound' ? select.value : Number(select.value);
   preferences = normalizeGraphPreferences({...preferences, [key]: value});
   font.disabled = !preferences.labels;
   change(preferences);
  };
  row.append(caption, select); menu.append(row); return select;
 }
 control('spacing', '布局疏密', [['0.75', '紧凑'], ['1', '标准'], ['1.35', '疏松']]);
 control('rebound', '拖动回弹', [['soft', '柔和'], ['standard', '标准']]);
 control('labels', '节点文字', [['true', '显示'], ['false', '隐藏']]);
 const font = control('fontSize', '字体大小', [['11', '11 px'], ['13', '13 px'], ['16', '16 px']]);
 font.disabled = !preferences.labels;
}
