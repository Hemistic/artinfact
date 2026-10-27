import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {MAX_PDF_BYTES} from './reader-service.js';
export function publicPaperUrl(value:string){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||value.length>4000||url.port&&url.port!=='443')throw Error('论文链接必须是公开 HTTPS 地址');if(url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal'))throw Error('论文链接不能指向本机或内网');return url;}
export function publicPaperAddress(address:string){
 if(isIP(address)===4){const a=address.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]>=224);}
 if(isIP(address)===6){const a=new URL('https://['+address+']/').hostname.replace(/^\[|\]$/g,'').toLowerCase();if(a.startsWith('::ffff:'))return publicPaperAddress(a.slice(7));return !/^(?:::(?:1)?$|f[cd]|ff|fe[89ab])/.test(a);}return false;
}
export async function downloadPaper(value:string,signal?:AbortSignal):Promise<{bytes:Buffer;url:string}>{
 let url=publicPaperUrl(value);const deadline=Date.now()+90000,abort=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
 for(let redirects=0;redirects<6;redirects++){
  if(signal?.aborted)throw Error('论文下载已停止');const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});if(!addresses.length||addresses.some(a=>!publicPaperAddress(a.address)))throw Error('论文下载地址解析到了本机或内网');
  const selected=addresses.find(a=>a.family===4)??addresses[0];
  const reply=await new Promise<{bytes?:Buffer;redirect?:string}>((resolve,reject)=>{
   const req=request(url,{method:'GET',family:selected.family,headers:{'User-Agent':'Artinfact/0.12 PDF research','Accept':'application/pdf,application/octet-stream;q=0.8'},lookup:(_host,_options,done)=>done(null,selected.address,selected.family),signal:abort},response=>{
    if([301,302,303,307,308].includes(response.statusCode??0)){const location=response.headers.location;response.resume();if(!location){reject(Error('论文下载重定向缺少地址'));return;}resolve({redirect:location});return;}
    if(response.statusCode!==200){response.resume();reject(Error('论文下载失败，HTTP '+response.statusCode));return;}
    if(Number(response.headers['content-length']??0)>MAX_PDF_BYTES){response.destroy();reject(Error('论文 PDF 超过 64 MB'));return;}
    const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_PDF_BYTES){response.destroy(Error('论文 PDF 超过 64 MB'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>{const bytes=Buffer.concat(chunks);if(!bytes.length||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))){reject(Error('下载结果不是 PDF，可能是网页或访问限制'));return;}resolve({bytes});});
   });req.setTimeout(Math.max(1,deadline-Date.now()),()=>req.destroy(Error('论文下载超时')));req.on('error',reject);req.end();
  });
  if(reply.bytes)return {bytes:reply.bytes,url:url.href};url=publicPaperUrl(new URL(reply.redirect!,url).href);
 }throw Error('论文下载重定向次数过多');
}
