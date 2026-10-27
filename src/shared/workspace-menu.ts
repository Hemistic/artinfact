type Progress={documents?:{ready:boolean;total:number;completed:number;aiCompleted?:number}[];tasks?:{status:string;completed:number;total:number}[]};
export function graphProcessingState(data:Progress,hasGraph:boolean){
 const docs=data.documents??[],active=[...(data.tasks??[])].reverse().find(t=>['queued','running'].includes(t.status));
 const completed=docs.filter(d=>d.ready&&d.total>0&&d.completed===d.total).length;
 return{running:!!active,graphLabel:hasGraph?'更新 AI 洞察图谱':'生成 AI 洞察图谱',status:active?`旧 AI 任务 · ${active.completed}/${active.total} 项`:`基础资料就绪 ${completed}/${docs.length} 篇 · AI 仅在主动调用时运行`};
}
