import {canvasControlHeight} from './canvas-control-size.js';
type Box={x:number;y:number;width:number;height:number};
type Point={x:number;y:number};
const intersects=(a:Box,b:Box)=>a.x<b.x+b.width+6&&a.x+a.width>b.x-6&&a.y<b.y+b.height+6&&a.y+a.height>b.y-6;
function labelHeight(text:string,width:number){
 // Match the 12px type, 16px line and compact padding used by the label.
 let lines=1,used=0;for(const char of text){const advance=/[^\x00-\xff]/.test(char)?12:7;if(char==='\n'){lines++;used=0;}else{if(used+advance>width-canvasControlHeight-10){lines++;used=0;}used+=advance;}}
 return Math.max(canvasControlHeight,lines*16+4);
}
export function connectionLabelPosition(point:Point,boxes:Box[]=[],options:{text?:string;occupied?:Box[]}={}){
 const text=options.text??'',natural=Math.max(40,Math.min(180,Array.from(text).reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?12:7),canvasControlHeight+10)));
 let width=natural,height=labelHeight(text,width);
 // Fit the existing horizontal corridor before moving a label away from its line.
 const row=boxes.filter(b=>point.y>b.y-height/2-6&&point.y<b.y+b.height+height/2+6),left=Math.max(-Infinity,...row.filter(b=>b.x+b.width<=point.x).map(b=>b.x+b.width)),right=Math.min(Infinity,...row.filter(b=>b.x>=point.x).map(b=>b.x));
 const gap=2*Math.min(point.x-left,right-point.x)-16;if(gap>=96&&gap<width){width=Math.floor(gap);height=labelHeight(text,width);}
 const rect=(p:Point):Box=>({x:p.x-width/2,y:p.y-height/2,width,height}),obstacles=[...boxes,...(options.occupied??[])];
 const free=(p:Point)=>!obstacles.some(b=>intersects(rect(p),b));
 if(free(point))return{...point,width,height};
 const candidates:Point[]=[];
 for(const b of obstacles){if(Math.abs(b.x+b.width/2-point.x)>b.width/2+1000||Math.abs(b.y+b.height/2-point.y)>b.height/2+1000)continue;
  candidates.push({x:point.x,y:b.y-height/2-10},{x:point.x,y:b.y+b.height+height/2+10},{x:b.x-width/2-10,y:point.y},{x:b.x+b.width+width/2+10,y:point.y});
 }
 if(obstacles.length)candidates.push({x:point.x,y:Math.min(...obstacles.map(b=>b.y))-height/2-10},{x:point.x,y:Math.max(...obstacles.map(b=>b.y+b.height))+height/2+10});
 candidates.sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y));
 const best=candidates.find(free)??point;return{...best,width,height};
}

