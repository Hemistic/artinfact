// Cache intrinsic KaTeX dimensions per formula, independent of the canvas camera.
export function formulaCardLayout(card:HTMLElement,body:HTMLElement){
 let measured:HTMLElement|undefined,naturalWidth=0,naturalHeight=0;
 const math=()=>body.querySelector<HTMLElement>('.flow-math');
 function measure(){const target=math(),katex=target?.querySelector<HTMLElement>('.katex');if(!target||!katex)return;
  if(measured!==katex||!naturalWidth){target.style.fontSize='16px';naturalWidth=Math.ceil(Math.max(katex.scrollWidth,katex.offsetWidth));naturalHeight=Math.ceil(Math.max(katex.scrollHeight,katex.offsetHeight));measured=katex;}
  return target;
 }
 function layout(limit?:number){const target=measure();if(!target||!naturalWidth)return;const available=Math.max(1,body.clientWidth),ratio=Math.min(1,available/naturalWidth,limit===undefined?1:Math.max(16,limit)/Math.max(1,naturalHeight));const size=(16*ratio).toFixed(3)+'px';if(target.style.fontSize!==size)target.style.fontSize=size;}
 // Account for KaTeX webfonts once, without remeasuring on every zoom frame.
 const ready=card.ownerDocument.fonts.ready.then(()=>{if(!card.isConnected)return;measured=undefined;});
 return{layout,ready,width(){measure();return naturalWidth?Math.max(220,Math.min(1400,naturalWidth+card.offsetWidth-body.clientWidth+4)):undefined;}};
}
