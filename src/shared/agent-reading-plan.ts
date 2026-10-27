type Target={kind:string;documentId?:string};
type Task={id?:string;sourceIds?:string[];action?:string;cardAction?:{action:string;output?:string}};
type ReadingSource={id:string;category?:string;assetId?:string};
type ReadingNode={sourceId?:string;note?:string;workflow?:{result?:{markdown?:string;imageAssetId?:string}}};
type ReadingContext={assetIds?:string[];source?:ReadingSource;sources?:ReadingSource[];node?:ReadingNode;nodes?:ReadingNode[];inputs?:ReadingNode[]};
const nodeAssets=(node:ReadingNode)=>[...new Set([...[node.note,node.workflow?.result?.markdown].flatMap(text=>[...(text??'').matchAll(/flow-asset:([a-zA-Z0-9_-]+)/g)].map(match=>match[1])),...(node.workflow?.result?.imageAssetId?[node.workflow.result.imageAssetId]:[])])];
export function agentReadingTools(workspaceId:string,target:Target,task:Task,context:ReadingContext,selectionOnly:boolean){
 if(selectionOnly)return [];
 if(target.kind==='reference')return task.action==='abstract'?[]:[{tool:'pdf_reference_paper_read',arguments:{workspaceId,documentId:target.documentId,taskId:task.id,offset:0,length:24000,waitMs:0},continueWith:'先按任务绑定核实的论文，准备完成后按 end 继续；readingProgress.complete 才表示全文覆盖。准备中只在下一次实际读取使用 waitMs:30000，不循环空查。'}];
 if(target.kind==='pdf_ai')return [];
 const tools:Record<string,unknown>[]=[];
 for(const sourceId of new Set(task.sourceIds??[]))tools.push({tool:'whiteboard_source_read',arguments:{workspaceId,sourceId,offset:0,limit:40000},continueWith:'同一 sourceId 按返回的 nextOffset 继续读取，直到 nextOffset 为 null；totalCharacters 是全文 UTF-16 长度。原样保留引用偏移，不重复读取已覆盖内容。'});
 const nodes=[...(context.node?[context.node]:[]),...(context.nodes??[]),...(context.inputs??[])],sources=[...(context.source?[context.source]:[]),...(context.sources??[])],assets=new Set(context.assetIds??[]),coveredSources=new Set<string>();
 for(const node of nodes){const ids=nodeAssets(node);for(const id of ids)assets.add(id);if(node.sourceId&&ids.length)coveredSources.add(node.sourceId);}
 if(context.source&&context.assetIds?.length)coveredSources.add(context.source.id);
 for(const source of sources){if(!['figure','table','formula'].includes(source.category??''))continue;if(source.assetId){assets.add(source.assetId);coveredSources.add(source.id);}}
 // Region, edge and workflow tasks also need the original images, not only source text.
 const requested=new Set<string>();
 for(const source of sources)if(['figure','table','formula'].includes(source.category??'')&&!coveredSources.has(source.id)&&!requested.has(source.id)){tools.push({tool:'whiteboard_source_image',arguments:{workspaceId,sourceId:source.id}});requested.add(source.id);}
 for(const id of assets)tools.push({tool:'whiteboard_asset_read',arguments:{workspaceId,id}});
 return tools;
}

export function cardResultGuide(task:Task,context:{node?:{presentation?:{type:string;latex?:string};kind?:string};source?:{category?:string;latex?:string}}){
 if(!task.cardAction)return undefined;
 const action=task.cardAction.action,related=task.cardAction.output==='related-note',type=context.node?.presentation?.type??(context.source?.category==='formula'?'formula':undefined);
 return{destination:related?'关联卡片，保留原卡':'当前卡片',
  markdown:action==='recognize_table'?'只回传表头、数值、单位、脚注和 Markdown 表格；不重发原图。':action==='derive_formula'?'按数学步骤写独立推导笔记，区分原文步骤与补充推断。':'按用户指令回传完整的目标 Markdown，不是补丁。',
  ...(related?{presentation:'省略该字段'}:type==='formula'?{presentation:{type:'formula',latex:context.node?.presentation?.latex??context.source?.latex,explanation:'公式说明',symbols:[{latex:'原文符号',meaning:'原文定义；缺失时写未知'}]}}:type==='evidence'?{presentation:{type:'evidence',statement:'证据内容',explanation:'解释与支持范围'}}:{presentation:'省略该字段'}),
  media:['figure','table','formula'].includes(context.source?.category??'')?'原图片、图题和公式由系统保留；说明正文不重复嵌入媒体。':'保留原笔记中的图片附件与引用，不删除现有媒体链接。',
  ...(action==='draw_explanation'?{imageAssetId:'必须实际生成新图并用 whiteboard_asset_put 保存后返回的 ID'}:{})};
}
