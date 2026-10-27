import {Settings,Home,Download,Play,Library,FileText,PanelsTopLeft,Link,Sparkles,Undo2,Redo2,Ellipsis,SquareDashed,Scan,Move,Minus,Plus,X,Moon,Network,Workflow,ChevronDown,ChevronUp,type IconNode} from 'lucide';
const icons={settings:Settings,home:Home,export:Download,play:Play,library:Library,note:FileText,board:PanelsTopLeft,link:Link,agent:Sparkles,undo:Undo2,redo:Redo2,more:Ellipsis,tools:SquareDashed,fit:Scan,resize:Move,minus:Minus,plus:Plus,close:X,theme:Moon,dots:Network,canvas:Workflow,chevronDown:ChevronDown,chevronUp:ChevronUp} satisfies Record<string,IconNode>;
export function canvasIcon(name:keyof typeof icons){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false','data-icon':name}))svg.setAttribute(key,value);
 for(const [tag,attrs]of icons[name]){const node=document.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))if(value!==undefined)node.setAttribute(key,String(value));svg.append(node);}
 return svg;
}
