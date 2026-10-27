import {ResearchWiki} from './research-wiki.js';
import {renderGraphDocument} from './wiki-graph-render.js';
import type {WorkspaceRuntime} from './workspace-runtime.js';

export async function workspaceGraphView(runtime:WorkspaceRuntime,workspaceId:string,template:string){
 const wiki=new ResearchWiki(runtime.library,runtime),graph=await wiki.graph(workspaceId);
 const pages:Record<string,string>={};let remaining=2*1024*1024;
 for(const node of graph.nodes){
  if(!node.relativePath||!(/^(?:wiki\/.*\.md|CLAUDE\.md|WIKI\.md)$/.test(node.relativePath))||node.type==='missing'||pages[node.relativePath]!==undefined||remaining<=0)continue;
  const page=await wiki.read(workspaceId,node.relativePath);
  const excerpt=page.text.slice(0,Math.min(12000,remaining));pages[node.relativePath]=excerpt;remaining-=excerpt.length;
 }
 const data=JSON.stringify(pages).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const displayed={...graph,nodes:graph.nodes.map((node:any)=>node.status==='seed'&&node.relativePath==='wiki/overview.md'?{...node,type:'meta'}:node)};
 return {html:renderGraphDocument(template,displayed,(await runtime.library.get(workspaceId)).name).replace('<!--GRAPH_PAGES-->',()=>data),generatedAt:graph.generatedAt,summary:graph.summary};
}
