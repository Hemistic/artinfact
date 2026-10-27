import {markdownHtml} from './flow-notes.js';
export function inspectorLayout(panel:HTMLElement){
 const doc=panel.ownerDocument,content=doc.createElement('div'),actions=doc.createElement('footer');
 content.className='wb-inspector-content';actions.className='wb-inspector-actions';actions.setAttribute('role','toolbar');actions.setAttribute('aria-label','卡片操作');panel.replaceChildren(content,actions);return {content,actions};
}
export async function loadInspectorPage(preview:HTMLElement,read:()=>Promise<{markdown?:string}>,current:()=>boolean){
 preview.textContent='正在读取完整正文…';preview.setAttribute('aria-busy','true');
 try{const result=await read();if(!current()||!preview.isConnected)return;
  if(result.markdown===undefined)preview.textContent='完整正文尚未同步，请在底部“更多”中同步 Pages 引用。';
  else preview.innerHTML=markdownHtml(result.markdown,{resources:false})||'<p>此 Pages 页面正文为空。</p>';
 }catch(e){if(current()&&preview.isConnected)preview.textContent='正文读取失败：'+String(e)+'。可重新选中卡片重试。';}
 finally{if(current()&&preview.isConnected)preview.removeAttribute('aria-busy');}
}
