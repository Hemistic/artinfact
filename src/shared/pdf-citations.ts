import {agentTaskPrompt} from './agent-task.js';
export type CitationRect=[number,number,number,number];
export type PdfCitationMarker={id:string;text:string;pageIndex:number;sourceIds:string[];blockId:string;sourceRect?:CitationRect;ordinal:number;count:number;kind?:'bibliography-entry'};
export type PdfReferenceIndex={revision:string;documentId:string;phase:'ready'|'unparsed';references:{id:string;title:string;raw:string;year?:string;url?:string;doi?:string}[];markers:PdfCitationMarker[]};
export type ReferenceAction='abstract'|'study'|'summarize'|'download';
export type PdfReferenceJob={id:string;workspaceId:string;documentId:string;action:ReferenceAction;status:'queued'|'running'|'completed'|'failed'|'cancelled';message:string;referenceId:string;markerId:string;createdAt:string;updatedAt:string;delivery?:string;instructions?:string;addToWorkspace?:boolean;annotationId?:string;importedDocumentId?:string;sourceCardId?:string;readingProgress?:{readCharacters:number;total:number;complete:boolean};downloadReady?:boolean;downloadBusy?:boolean;outputLanguage?:'zh'|'en'};
type Char={c?:string;u?:string;rect?:number[];inlineRect?:number[];lineBreakAfter?:boolean};
// PDF text layers can encode an author's accent as a separate glyph while OCR omits it.
export const normalizeCitationText=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/[\p{M}\s\u00ad]/gu,'').replace(/[–—]/g,'-');
const pageIndexes=new WeakMap<Char[],Map<string,{text:string;indexes:number[]}>>();
export function findCitationRects(chars:Char[],text:string,bounds?:number[],ordinal?:number,expected?:number,bibliography=false):CitationRect[]{
 if(!chars.length||chars.length>200000||!text||text.length>500)return [];
 let needle=normalizeCitationText(text);if(!needle)return [];
 let indexes=pageIndexes.get(chars);if(!indexes){indexes=new Map();pageIndexes.set(chars,indexes);}const key=JSON.stringify(bounds??null);
 let data=indexes.get(key);if(!data){data={text:'',indexes:[]};for(let i=0;i<chars.length;i++){const char=chars[i],rect=char.inlineRect??char.rect;if(!rect||rect.length!==4||!rect.every(Number.isFinite))continue;const x=(rect[0]+rect[2])/2,y=(rect[1]+rect[3])/2;if(bounds&&(x<bounds[0]-3||x>bounds[2]+3||y<bounds[1]-3||y>bounds[3]+3))continue;const normalized=normalizeCitationText(char.c??char.u??'');data.text+=normalized;for(let n=0;n<normalized.length;n++)data.indexes.push(i);}if(indexes.size>=64)indexes.delete(indexes.keys().next().value!);indexes.set(key,data);}
 const matches:number[]=[];const match=()=>{for(let at=data!.text.indexOf(needle);at>=0&&matches.length<201;at=data!.text.indexOf(needle,at+needle.length))matches.push(at);};match();
 if(!matches.length&&bibliography&&bounds&&needle.length>=60){
  // OCR joins line-end hyphenation; still require the entire entry to match uniquely inside its source box.
  const joined={text:'',indexes:[] as number[]};for(let i=0;i<data.text.length;i++)if(data.text[i]!=='-'){joined.text+=data.text[i];joined.indexes.push(data.indexes[i]);}data=joined;needle=needle.replace(/-/g,'');match();
 }
 if(expected!==undefined&&matches.length!==expected||ordinal===undefined&&matches.length!==1)return [];
 const at=matches[ordinal??0];if(at===undefined)return [];const start=data.indexes[at],end=data.indexes[at+needle.length-1],rects:CitationRect[]=[];let current:CitationRect|undefined;
 for(let i=start;i<=end;i++){const char=chars[i],r=char.inlineRect??char.rect;if(!r||r.length!==4)continue;if(current&&(Math.abs((r[1]+r[3]-current[1]-current[3])/2)>Math.max(2,(current[3]-current[1])/2)||r[0]>current[2]+30)){rects.push(current);current=undefined;}current=current?[Math.min(current[0],r[0]),Math.min(current[1],r[1]),Math.max(current[2],r[2]),Math.max(current[3],r[3])]:r.slice(0,4) as CitationRect;if(char.lineBreakAfter){rects.push(current);current=undefined;}}
 if(current)rects.push(current);return rects.slice(0,8);
}
export function referenceActionPrompt(task:Pick<PdfReferenceJob,'workspaceId'|'documentId'|'id'|'action'>){
 const base=agentTaskPrompt(task.workspaceId,{kind:'reference',documentId:task.documentId,taskId:task.id},'参考文献：'+task.action);
 if(task.action==='abstract')return base+'\n第一级：只读取并解读被引论文的摘要。通过网络实际读取论文官方页面、arXiv、期刊或会议页面上的摘要，核对题名、作者和年份；没有摘要时如实失败，不用引用方的描述或搜索片段代替。不要下载 PDF、启动 MinerU 或执行全文研读。按 languagePolicy.outputLanguage 简短说明问题、方法和作者在摘要中报告的结果，并标明“仅依据摘要，尚未阅读全文”。按 completion 调用 agent_task_complete，result 传 paperTitle、sourceUrl、实际读到的完整 abstract、title、简短 markdown，以及 abstract 内精确的 citations:{start,end,quote}。结果保存为 PDF 侧栏的摘要解读批注；不创建白板、不添加卡片。保存后在聊天中展示简短解读；用户感兴趣时再选择第二级深入批注式阅读。';
 const common=base+`必要时通过网络搜索核对原论文的官方或公开来源，不凭记忆猜 PDF 地址。paperTitle 必须与文献条目对应；优先复用 workspace 中已有的对应 PDF，调用 pdf_reference_paper_prepare 并传 citedDocumentId（该工具仅操作本机已有论文），不能用当前引用它的 PDF 冒充被引论文。需要外部论文时，调用 pdf_reference_paper_resolve 回传已核对的 paperTitle、pdfUrl、来源页面 sourceUrl；下载由主程序执行此任务已授权的操作，不要调用仅供界面的下载工具。调用 pdf_reference_paper_read，准备中时用 waitMs=30000 等待，不重复下载或解析；下载和解析在后台继续，可在工作台查看状态。`;
 if(task.action==='download')return common+'\n任务：下载这篇被引论文并添加到当前 workspace。不要用网页 HTML 冒充 PDF，不绕过访问限制。通过 pdf_reference_action_read 或 pdf_reference_paper_read 确认任务 completed 后才报告成功。不可访问或文献不匹配则调用 pdf_reference_action_status 记录 failed，说明真实原因。';
 if(task.action==='study')return common+('addToWorkspace' in task&&task.addToWorkspace?'用户明确选择了将原 PDF 加入 workspace，保存研读结果时由程序导入。':'本次未授权把外部 PDF 加入 workspace。')+'\n第二级：深入批注式阅读。必须分页实际阅读被引论文的完整 MinerU Markdown，包括方法、实验、限制和附录；每次读取按返回的 end 继续，直到 readingProgress.complete=true，不能把摘要、开头或几条引用当作全文。按 languagePolicy.outputLanguage 组织全面研读：研究问题、方法与关键机制、创新、实验设置与结果、局限、与当前论文的联系和待验证问题。保留公式并正确使用 LaTeX。围绕关键段落提供 annotations:[{section,comment,start,end,quote}]，其中 section/comment 由你实际研读后撰写，quote 必须是该论文准确原文切片；覆盖不同章节，建议 6–12 项，短文按内容调整。按 completion 调用 agent_task_complete，result 传 title、markdown（综合研读笔记）、paperHash、至少两段精确 citations 和 annotations。MCP 将保存 PDF 侧栏的全面批注，并生成一张完整研读卡片放入共享卡片库的“待添加”区。不要调用白板新建、whiteboard_add_cards、whiteboard_patch 或创建连接，不自动摆放卡片；仅当 task.addToWorkspace=true 时由程序将缓存 PDF 加入 workspace。仅保存成功后报告卡片待添加。';
 return common+'\n任务：总结被引论文自身的主要贡献，不是仅归纳当前论文如何引用它的观点。复用或等待被引论文的本机 MinerU 标准 Markdown/JSON，分页实际阅读正文；总结操作不自动把外部论文添加到书册。按 languagePolicy.outputLanguage 提炼 3–5 条具体贡献，区分方法、实验支持与限制，按简洁 Markdown 编排。必须给出至少两段被引论文的准确原文 citations:{start,end,quote}。调用 pdf_reference_action_complete，传 title、markdown、paperHash 和 citations，将结果作为当前 PDF 的引用贡献批注加入侧栏。位置由任务绑定，不能猜坐标、覆盖手工批注或改动其他论文。仅完成实际保存后才报告成功；无法阅读全文时记录 failed，不伪装成全文总结。';
}
