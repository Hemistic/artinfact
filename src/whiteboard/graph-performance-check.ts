type Scenario={step:(dt:number,elapsed:number)=>void;draw:()=>void};
type Result={nodes:number;edges:number;fps:number;frameP95ms:number;physicsP95ms:number;drawP95ms:number;firstDrawMs:number;samples:number};
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
const rounded=(n:number)=>Math.round(n*100)/100;
// Opt-in, in-host measurements. Synthetic data never reaches the workspace or MCP store.
export async function runGraphPerformanceCheck(hooks:{viewport:()=>{width:number;height:number;dpr:number};prepare:(count:number)=>Scenario}){
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','图谱性能检查');dialog.style.cssText='max-width:520px;width:calc(100% - 48px);max-height:70vh;overflow:auto;border:1px solid #bbb;border-radius:12px;padding:18px;background:var(--panel,#fff);color:var(--fg,#222)';
 const title=document.createElement('h3');title.textContent='图谱性能检查';
 const hint=document.createElement('p');hint.textContent='在当前窗口用临时节点测量持续拖动帧率，完成后恢复原图。切换窗口会停止。';
 const status=document.createElement('p');status.setAttribute('role','status');
 const table=document.createElement('pre');table.style.cssText='white-space:pre-wrap;font:12px monospace';table.dataset.graphPerformance='true';
 const stop=document.createElement('button');stop.type='button';stop.textContent='停止';
 dialog.append(title,hint,status,table,stop);document.body.append(dialog);dialog.showModal();
 const controller=new AbortController(),results:Result[]=[];let finished=false;
 stop.onclick=()=>{if(finished){dialog.close();dialog.remove();}else controller.abort();};
 const cancel=(e:Event)=>{if(!finished){e.preventDefault();controller.abort();}};dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',()=>dialog.remove());
 const hidden=()=>{if(document.hidden)controller.abort();};document.addEventListener('visibilitychange',hidden);
 const stopHidden=()=>controller.abort();document.addEventListener('artinfact:graph-benchmark-stop',stopHidden);
 let stalled=false;
 const nextFrame=()=>new Promise<number|undefined>(resolve=>{if(controller.signal.aborted){resolve(undefined);return;}const abort=()=>{clearTimeout(watchdog);cancelAnimationFrame(id);resolve(undefined);};const id=requestAnimationFrame(time=>{clearTimeout(watchdog);controller.signal.removeEventListener('abort',abort);resolve(time);});const watchdog=setTimeout(()=>{stalled=true;controller.abort();},3000);controller.signal.addEventListener('abort',abort,{once:true});});
 try{
  for(const count of [100,250,500,1000,2000,4000,8000]){
   if(controller.signal.aborted)break;
   status.textContent=`${count} 个节点 · ${count*2} 条连线`;
   const scenario=hooks.prepare(count),intervals:number[]=[],physics:number[]=[],draws:number[]=[];let start:number|undefined,last:number|undefined,firstDraw=0;
   while(!controller.signal.aborted){
    const now=await nextFrame();if(now===undefined)break;start??=now;const elapsed=now-start,dt=last===undefined?1:Math.min(2,(now-last)/16.67);
    if(last!==undefined&&elapsed>600)intervals.push(now-last);last=now;
    const t=performance.now();scenario.step(dt,elapsed);const t2=performance.now();scenario.draw();const t3=performance.now();if(elapsed===0)firstDraw=t3-t;
    if(elapsed>600){physics.push(t2-t);draws.push(t3-t2);}if(elapsed>=4600)break;
   }
   if(controller.signal.aborted)break;
   const fps=1000*intervals.length/intervals.reduce((sum,n)=>sum+n,0);
   results.push({nodes:count,edges:count*2,fps:rounded(fps),frameP95ms:rounded(percentile(intervals,.95)),physicsP95ms:rounded(percentile(physics,.95)),drawP95ms:rounded(percentile(draws,.95)),firstDrawMs:rounded(firstDraw),samples:intervals.length});
   table.textContent=JSON.stringify({viewport:hooks.viewport(),results},null,2);
   if(fps<15)break;
  }
  status.textContent=stalled?'未收到动画帧，请将插件置于前台后重试。原图已恢复。':controller.signal.aborted?'已停止，原图已恢复':'测量完成，原图已恢复';
  table.textContent=JSON.stringify({viewport:hooks.viewport(),results,stopped:controller.signal.aborted,done:true},null,2);
 }finally{finished=true;stop.textContent='关闭';document.removeEventListener('visibilitychange',hidden);document.removeEventListener('artinfact:graph-benchmark-stop',stopHidden);}
}
