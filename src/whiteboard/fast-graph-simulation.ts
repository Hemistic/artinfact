import {normalizeGraphPreferences,type GraphPreferences} from './graph-preferences.js';
type Node={id:string;x:number;y:number;type:string};
type Edge={source:string;target:string;relation:string;weight:number};
type Particle={node:Node;x:number;y:number;pinned:boolean;released:number;degree:number};
type Cell={left:number;top:number;size:number;count:number;x:number;y:number;items:Particle[];children?:Cell[]};
// Distant cells contribute one aggregate force; nearby particles retain exact separation.
function createTree(){
 const pool:Cell[]=[];let used=0;
 const cell=(left:number,top:number,size:number):Cell=>{const c=pool[used]??(pool[used]={left,top,size,count:0,x:0,y:0,items:[]});used++;c.left=left;c.top=top;c.size=size;c.count=c.x=c.y=0;c.items.length=0;c.children=undefined;return c;};
 return (particles:Particle[]):Cell=>{
 used=0;
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const {node:n} of particles){left=Math.min(left,n.x);top=Math.min(top,n.y);right=Math.max(right,n.x);bottom=Math.max(bottom,n.y);}
 const root=cell(left,top,Math.max(1,right-left,bottom-top)+.01);
 function insert(c:Cell,p:Particle,depth:number){
  c.count++;c.x+=p.node.x;c.y+=p.node.y;
  if(!c.children&&(c.items.length<4||depth>=24)){c.items.push(p);return;}
  const half=c.size/2;
  const child=(p:Particle)=>c.children![(p.node.x>=c.left+half?1:0)+(p.node.y>=c.top+half?2:0)];
  if(!c.children){c.children=[cell(c.left,c.top,half),cell(c.left+half,c.top,half),cell(c.left,c.top+half,half),cell(c.left+half,c.top+half,half)];for(const item of c.items)insert(child(item),item,depth+1);c.items=[];}
  insert(child(p),p,depth+1);
 }
 for(const p of particles)insert(root,p,0);return root;
 };
}
function repel(p:Particle,x:number,y:number,count:number,temperature:number,near:boolean,spacing:number,repulsion:number){
 const dx=x-p.node.x||.01,dy=y-p.node.y||.01,d2=Math.max(36,dx*dx+dy*dy),distance=Math.sqrt(d2);
 const f=(repulsion*count/d2+(near?Math.max(0,155*spacing-distance)*.16:0))*temperature/distance;
 p.x-=dx*f;p.y-=dy*f;
}
function repelTree(p:Particle,c:Cell,temperature:number,spacing:number,repulsion:number){
 if(!c.count)return;
 if(!c.children){for(const other of c.items)if(other!==p)repel(p,other.node.x,other.node.y,1,temperature,true,spacing,repulsion);return;}
 const x=c.x/c.count,y=c.y/c.count,dx=x-p.node.x,dy=y-p.node.y,d2=dx*dx+dy*dy;
 const gapX=Math.max(c.left-p.node.x,0,p.node.x-c.left-c.size),gapY=Math.max(c.top-p.node.y,0,p.node.y-c.top-c.size);
 if(gapX*gapX+gapY*gapY>155*155*spacing*spacing&&c.size*c.size<.81*d2){repel(p,x,y,c.count,temperature,false,spacing,repulsion);return;}
 for(const child of c.children)repelTree(p,child,temperature,spacing,repulsion);
}
export function createFastGraphSimulation(nodes:Node[],edges:Edge[],options?:Partial<GraphPreferences>){
 let preferences=normalizeGraphPreferences(options);
 let spacing=preferences.spacing,repulsion=4800*spacing**3;
 const profiles={soft:{damping:.72,ramp:18,heat:.18,speed:8},standard:{damping:.8,ramp:8,heat:.24,speed:10}};
 let motion=profiles[preferences.rebound];
 const particles:Particle[]=nodes.map(node=>({node,x:0,y:0,pinned:false,released:1,degree:0})),lookup=new Map(particles.map(p=>[p.node.id,p]));
 const tree=createTree();
 // Resolve edge endpoints and constants once, rather than doing Map lookups
 // inside every spring and every node pair on every physics substep.
 const springs=edges.flatMap(edge=>{const a=lookup.get(edge.source),b=lookup.get(edge.target);if(!a||!b||a===b)return[];a.degree++;b.degree++;return[{a,b,desired:230*(edge.relation==='raw-source'?1.28:1),weight:Math.min(2.2,Math.max(.45,edge.weight||1))}];});
 let alpha=.65;const reheat=()=>{alpha=.65;};
 return{
  active:()=>alpha>.004,reheat,
  configure(options:GraphPreferences){preferences=normalizeGraphPreferences(options);spacing=preferences.spacing;repulsion=4800*spacing**3;motion=profiles[preferences.rebound];},
  settle(){alpha=0;for(const p of particles){p.x=0;p.y=0;}},
  pin(id:string,x:number,y:number){const p=lookup.get(id);if(!p)return;p.node.x=x;p.node.y=y;p.pinned=true;p.x=p.y=0;alpha=Math.max(alpha,motion.heat);},
  release(id:string){const p=lookup.get(id);if(!p)return;p.pinned=false;p.x=p.y=0;p.released=0;alpha=Math.max(alpha,motion.heat);},
  step(dt=1){
   // Integrate elapsed time once, including on high-refresh displays; don't catch up long pauses.
   const duration=Math.max(.1,Math.min(2,dt)),steps=Math.ceil(duration),h=duration/steps,damping=Math.pow(motion.damping,h),cooling=Math.pow(.975,h);
   for(let step=0;step<steps&&alpha>.004;step++){
    const temperature=alpha*h;
    for(const {a,b,desired,weight}of springs){
     const dx=b.node.x-a.node.x,dy=b.node.y-a.node.y,distance=Math.max(1,Math.hypot(dx,dy)),force=(distance-desired*spacing)*.01*temperature*weight/Math.sqrt(Math.max(1,Math.min(a.degree,b.degree)));
     if(!a.pinned){a.x+=dx/distance*force;a.y+=dy/distance*force;}
     if(!b.pinned){b.x-=dx/distance*force;b.y-=dy/distance*force;}
    }
    if(particles.length>=512){const root=tree(particles);for(const p of particles)if(!p.pinned)repelTree(p,root,temperature,spacing,repulsion);}
    else for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){
     const a=particles[i],b=particles[j],dx=b.node.x-a.node.x||.01,dy=b.node.y-a.node.y||.01,distance2=Math.max(36,dx*dx+dy*dy),distance=Math.sqrt(distance2),force=(repulsion/distance2+Math.max(0,155*spacing-distance)*.16)*temperature;
     if(!a.pinned){a.x-=dx/distance*force;a.y-=dy/distance*force;}
     if(!b.pinned){b.x+=dx/distance*force;b.y+=dy/distance*force;}
    }
    for(const p of particles)if(!p.pinned){
     const n=p.node,gravity=(n.type==='overview'||n.type==='meta')?.00318:.0012;
     p.x=(p.x-n.x*gravity*temperature)*damping;p.y=(p.y-n.y*gravity*temperature)*damping;
     p.released=Math.min(1,p.released+h/motion.ramp);const ease=p.released*p.released*(3-2*p.released);
     const speed=Math.hypot(p.x,p.y),limit=Math.min(1,motion.speed/Math.max(motion.speed,speed))*ease;
     n.x+=p.x*limit*h;n.y+=p.y*limit*h;
    }
    alpha*=cooling;
   }
  },
 };
}
