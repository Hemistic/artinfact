import type {JSDOM} from 'jsdom';
export function installNoteDom(dom:JSDOM){
 for(const key of ['window','document','navigator','HTMLElement','Element','SVGElement','HTMLInputElement','HTMLDivElement','Node','ShadowRoot','DOMParser','MutationObserver','CustomEvent','File','FileReader'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
 for(const key of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener','dispatchEvent'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key].bind(dom.window),configurable:true});
 dom.window.scrollBy=()=>{};
 dom.window.Range.prototype.getBoundingClientRect=()=>new dom.window.DOMRect(0,0,20,20);
 dom.window.Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
}

export async function editMathSource(formula:HTMLElement,value:string){
 formula.click();
 const source=formula.querySelector<HTMLElement>('.wb-note-math-source');
 if(!source)throw Error('Native math text missing');
 source.textContent=value;
 // Exercise the editor's DOM observer rather than a separate formula input control.
 await new Promise(resolve=>setTimeout(resolve,30));
}
