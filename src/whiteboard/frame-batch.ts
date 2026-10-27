export function frameBatch(draw:()=>void,request:(callback:FrameRequestCallback)=>number=requestAnimationFrame,cancel:(id:number)=>void=cancelAnimationFrame){
 let frame:number|undefined;
 return {schedule(){if(frame!==undefined)return;frame=request(()=>{frame=undefined;draw();});},cancel(){if(frame!==undefined)cancel(frame);frame=undefined;}};
}
