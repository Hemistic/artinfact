import{normalizeUiLanguage,translateUiText,translateUiMessage,originalUiText,type UiLanguage}from'../shared/ui-language.js';
const key='artinfact.ui-language';
export function uiLanguage():UiLanguage{
 if(typeof document==='undefined')return'zh';
 if(document.documentElement.dataset.uiLanguage)return normalizeUiLanguage(document.documentElement.dataset.uiLanguage);
 try{if(window.parent!==window&&window.parent.document.documentElement.dataset.uiLanguage)return normalizeUiLanguage(window.parent.document.documentElement.dataset.uiLanguage);}catch{}
 try{return normalizeUiLanguage(localStorage.getItem(key));}catch{return'zh';}
}
export function uiText(value:string){return translateUiText(value,uiLanguage());}
export function uiMessage(value:unknown){return typeof value==='string'?translateUiMessage(value,uiLanguage()):value;}
export function setUiLanguage(language:UiLanguage){document.documentElement.dataset.uiLanguage=language;document.documentElement.lang=language==='en'?'en':'zh-CN';try{localStorage.setItem(key,language);}catch{}}
export function captureStaticChrome(root:HTMLElement){
 const language=uiLanguage(),updates:(()=>void)[]=[];
 const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){
  if(node.parentElement?.closest('script,style,textarea,[contenteditable],[data-user-content]'))continue;
  const target=node,source=originalUiText(node.nodeValue??'',language);let last=node.nodeValue;
  updates.push(()=>{if(target.isConnected&&target.nodeValue===last){last=uiText(source);target.nodeValue=last;}});
 }
 for(const element of root.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))for(const attribute of ['title','aria-label','placeholder','alt'])if(element.hasAttribute(attribute)){
  const source=originalUiText(element.getAttribute(attribute)!,language);let last=element.getAttribute(attribute);
  updates.push(()=>{if(element.isConnected&&element.getAttribute(attribute)===last){last=uiText(source);element.setAttribute(attribute,last);}});
 }
 return()=>{for(const update of updates)update();};
}
export function localizeInitialMarkup(){
 setUiLanguage(uiLanguage());if(uiLanguage()!=='en')return;
 document.title=uiText(document.title);
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){const parent=node.parentElement;if(parent?.closest('script,style,[contenteditable],input,textarea,#graph-title,[data-user-content]'))continue;node.nodeValue=uiText(node.nodeValue??'');}
 for(const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))for(const name of ['title','aria-label','placeholder','alt'])if(el.hasAttribute(name))el.setAttribute(name,uiText(el.getAttribute(name)!));
}
if(typeof document!=='undefined')setUiLanguage(uiLanguage());
