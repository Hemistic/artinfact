export type NativeProgress={percent:number;step:string;completed?:number;total?:number};
export function parseLocalProgress(log:string):NativeProgress|undefined {
 const lines=log.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').split(/[\r\n]+/);
 for(const line of lines.reverse()){
  const match=/^(.+?):\s*(\d{1,3})%\|/.exec(line.trim());if(!match)continue;
  const percent=Number(match[2]);if(percent>100)return;
  const counts=/\|\s*(\d+)\/(\d+)\s*\[/.exec(line);
  return {percent,step:match[1].trim().slice(-120),...(counts?{completed:Number(counts[1]),total:Number(counts[2])}:{})};
 }
}
