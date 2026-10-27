/** Immutable asset IDs share one request and decoded URL across retained cards. */
export function createImageCache(read:(id:string)=>Promise<string>,concurrency=4,maxChars=24*1024*1024){
 const pending=new Map<string,Promise<string>>(),cache=new Map<string,string>();
 const waiting:(()=>void)[]=[];let running=0,chars=0;
 async function acquire(){if(running>=concurrency)await new Promise<void>(resolve=>waiting.push(resolve));else running++;}
 function release(){const next=waiting.shift();if(next)next();else running--;}
 return {async read(id:string):Promise<string>{
  const cached=cache.get(id);if(cached!==undefined){cache.delete(id);cache.set(id,cached);return cached;}
  const existing=pending.get(id);if(existing)return existing;
  const task=(async()=>{await acquire();try{const value=await read(id);if(value.length<=maxChars){cache.set(id,value);chars+=value.length;while(chars>maxChars){const key=cache.keys().next().value!;chars-=cache.get(key)!.length;cache.delete(key);}}return value;}finally{release();pending.delete(id);}})();
  pending.set(id,task);return task;
 },clear(){cache.clear();chars=0;}};
}
