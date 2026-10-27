import {readerIcon} from './icons.js';
type ReactFactory = Parameters<typeof readerIcon>[0];
type ToolbarWindow = { _reader?: { toggleAppearancePopup?(open?:boolean):void }; __codexGraphReturn?:boolean; __codexBackEnabled?:(native:boolean)=>boolean; __codexBackAction?:(native:()=>void)=>()=>void; __codexHomeButton?: (react:ReactFactory)=>unknown; __codexSettingsButton?: (react:ReactFactory)=>unknown };
export function installReaderToolbar(target:ToolbarWindow,report:(type:string,payload:object)=>void) {
  target.__codexBackEnabled=native=>!!target.__codexGraphReturn||native;
  target.__codexBackAction=native=>()=>{if(target.__codexGraphReturn)report('codex-reader:graph-back',{});else native();};
  target.__codexHomeButton = react => react.createElement('button', {id:'codexHome',type:'button',className:'toolbar-button',title:'返回工作区首页', 'aria-label':'返回工作区首页',tabIndex:-1,onClick:()=>report('codex-reader:workspace-action',{action:'home'})},readerIcon(react,'home'));
  // Keep the reader's appearance anchor ID while moving its settings into one menu.
  target.__codexSettingsButton = react => react.createElement('button',{id:'appearance',type:'button',className:'toolbar-button codex-settings-button',title:'设置','aria-label':'设置','aria-haspopup':'menu',tabIndex:-1,onClick:(event:{currentTarget:HTMLElement})=>{
    target._reader?.toggleAppearancePopup?.(false);
    const {left,right,bottom}=event.currentTarget.getBoundingClientRect();report('codex-reader:settings',{anchor:{left,right,bottom}});
  }},readerIcon(react,'settings'));
}
