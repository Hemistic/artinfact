import {showDropdown} from './dropdown.js';
import {setControlIcon,type UiIcon} from './icons.js';
import type {HomeSnapshot,HomeWorkspace} from './workspace-home-view.js';
type Hooks={settingsLabel?():string;run(action:()=>Promise<unknown>):void;select(id:string):Promise<void>;create():Promise<void>;rename(w:HomeWorkspace):Promise<void>;folder(w:HomeWorkspace):Promise<void>;choose(w:HomeWorkspace):Promise<void>;notes(w:HomeWorkspace):Promise<void>;settings():Promise<void>;archive(w:HomeWorkspace):Promise<void>};
export function installWorkspaceHomeMenus(root:HTMLElement,hooks:Hooks){
 const picker=document.createElement('dialog');picker.className='workspace-select-menu';picker.setAttribute('aria-label','工作区菜单');
 const manager=document.createElement('dialog');manager.className='workspace-manage-menu';manager.setAttribute('aria-label','管理当前工作区');root.append(picker,manager);
 function action(dialog:HTMLDialogElement,icon:UiIcon,label:string,run:()=>Promise<unknown>){const b=document.createElement('button');b.type='button';b.textContent=label;b.title=label;setControlIcon(b,icon);b.onclick=()=>{dialog.close();hooks.run(run);};return b;}
 return {
  select(snapshot:HomeSnapshot,id:string){picker.replaceChildren();const title=document.createElement('strong');title.textContent='工作区';const list=document.createElement('div');list.className='workspace-menu-list';list.setAttribute('role','menu');
   for(const w of snapshot.workspaces){const b=action(picker,w.id===id?'check':'folder',w.name,()=>hooks.select(w.id));b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(w.id===id));list.append(b);}picker.append(title,list,document.createElement('hr'),action(picker,'plus','新建工作区',hooks.create));showDropdown(picker);},
  manage(snapshot:HomeSnapshot,w:HomeWorkspace){manager.replaceChildren();const title=document.createElement('strong');title.textContent=w.name;manager.append(title,
   action(manager,'notes','重命名工作区',()=>hooks.rename(w)),action(manager,'folder','打开工作区文件夹',()=>hooks.folder(w)),action(manager,'fileInput','打开 PDF / 导入 Markdown',()=>hooks.choose(w)),action(manager,'notes','工作区笔记',()=>hooks.notes(w)),action(manager,'settings',hooks.settingsLabel?.()??'插件设置',hooks.settings),document.createElement('hr'));
   const remove=action(manager,'trash','删除工作区',()=>hooks.archive(w));remove.classList.add('destructive');remove.disabled=snapshot.workspaces.length<=1;remove.title=remove.disabled?'至少保留一个工作区':'从列表移除并保留可恢复归档';manager.append(remove);showDropdown(manager);},
  destroy(){picker.remove();manager.remove();}
 };
}
