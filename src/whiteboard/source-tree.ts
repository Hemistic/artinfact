import type {CardPresentation} from './card-presentation-schema.js';
export type AssetSource={id:string;name:string;format:string;ready:boolean;added?:boolean;processed?:boolean;basicReady?:boolean;analysisReady?:boolean;presentation?:CardPresentation;category?:string;documentId?:string;page?:number;caption?:string;latex?:string;preview?:string};
export type AssetFolder={id:string;label:string;items:AssetSource[]};
export type AssetRoot={id:string;name:string;count:number;folders:AssetFolder[]};
const categories=[['document','全文'],['section','章节'],['figure','图片与图表'],['table','表格'],['formula','公式'],['annotation','读者批注'],['insight','AI 洞察'],['reference','参考文献']] as const;
export function sourceLabel(source:AssetSource,paperName:string){
 if(source.category==='formula')return '公式'+(source.page?' · 第 '+source.page+' 页':'');
 if(source.caption?.trim())return source.caption.trim();
 for(const prefix of [paperName,paperName.replace(/\.(pdf|md|markdown)$/i,'')]){
  if(source.name.startsWith(prefix+' · '))return source.name.slice(prefix.length+3);
 }
 return (source.category??'document')==='document'?'全文':source.name;
}
export function sourceTree(sources:AssetSource[],query=''):AssetRoot[]{
 const roots=new Map<string,AssetRoot>();
 const create=(id:string,name:string,paper:boolean)=>{const root={id,name,count:0,folders:paper?categories.map(([id,label])=>({id,label,items:[] as AssetSource[]})):[]};roots.set(id,root);return root;};
 for(const source of sources)if((source.category??'document')==='document')create(source.id,source.name,true);
 for(const source of sources){
  const category=source.category??'document';
  let root:AssetRoot;
  if(category==='pages')root=roots.get('pages')??create('pages','Pages',false);
  else if(category==='markdown'||source.format==='md')root=roots.get('markdown')??create('markdown','Markdown 笔记',false);
  else{const id=category==='document'?source.id:source.documentId??source.id;root=roots.get(id)??create(id,source.name.split(' · ')[0],true);}
  let folder=root.folders.find(f=>f.id===category);
  if(!folder){folder={id:category,label:category==='pages'?'Pages':category==='markdown'?'笔记':'其他资料',items:[]};root.folders.push(folder);}
  folder.items.push(source);root.count++;
 }
 const term=query.trim().toLocaleLowerCase();
 return [...roots.values()].flatMap(root=>{
  if(!term||root.name.toLocaleLowerCase().includes(term))return [root];
  const folders=root.folders.map(folder=>({...folder,items:folder.label.toLocaleLowerCase().includes(term)?folder.items:folder.items.filter(s=>[s.name,s.caption].some(v=>v?.toLocaleLowerCase().includes(term)))})).filter(f=>f.items.length);
  return folders.length?[{...root,folders}]:[];
 });
}
