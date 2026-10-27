import {z} from 'zod';
import {CardPresentationSchema} from './card-presentation-schema.js';
import type {Board,BoardNode} from './whiteboard-domain.js';
export const WorkflowTemplates=[
 {id:'similarity',name:'相同相似',description:'比较多篇论文的共同点、差异和创新关系。',instructions:'先建立论文比较表，按研究问题、机制、假设、输入输出和实验口径对齐。分别列出真正相同、部分相似、关键差异、互补或冲突，以及与各论文创新点的关系；不能仅因出现同一术语就判为相似。每条相同相似点至少附两份不同资料的准确依据，并解释相似的层次与适用条件。保留数据集、基线、指标、单位和检索库版本，条件不一致不可直接排名。区分作者声称的创新、你的推断和待验证设想；缺失证据明确记录。将具体发现分别提交为可选择的 findings 卡片，而非只输出一篇笼统总结。'},
 {id:'chart',name:'图表比较',description:'提取、解释或比较连接的图表。',instructions:'读取图表原图、表格正文、图注及论文上下文；列出指标、单位、基线与条件，对比相同/差异，说明不可比较项。不从图中臆造精确数字。'},
 {id:'formula',name:'公式讲解与推导',description:'识别公式、定位符号关系，逐步解释推导。',instructions:'公式和证据的简洁展示必须由 Agent 阅读原文后整理，不能用脚本生成解释。公式 presentation:{type:"formula",latex,explanation,symbols:[{latex,meaning}]}，证据 presentation:{type:"evidence",statement,explanation}；note 保留完整资料和分析，citations 保留准确依据。符号缺失定义写未知，不猜测。不要在展示字段中放 YAML、文件名、页码或同步状态。读取选中的公式块、原图和所属论文上下文，使用 LaTeX 展示准确公式及编号。先列符号定义、取值范围、单位、前提和所在原文；再逐步解释变形、代入或所用定理，并检查维度与边界情形。指出它连接的方法、目标函数、实验或其他公式，附对应段落依据。明确哪些步骤来自论文、哪些是补充推导；识别存疑、缺少定义或推导前提则标记未知，不编造。按独立解释或推导步骤提交 findings，方便用户只选其中部分输出。'},
 {id:'pages',name:'Pages 输出',description:'把连接的信源和分析结果组成私有 Pages。',instructions:'按连接文字及用户要求组合输入，整理创新、关系和证据，生成研究总结。通过 Pages write-page 流程新建私有页面，保留用户已编辑的原页面；实际 read_page 后将全部块和元数据回传，不用摘要冒充原文。失败不声称完成，未知创建结果先核实，避免重复创建。'},
 {id:'image',name:'生图输出',description:'按连接的分析与要求生成图片。',instructions:'根据用户要求和上游分析生成一张图片，科学机制图要忠实于证据并标明推断。使用可用生图工具，实际生成后保存图片到 whiteboard_asset_put，再回传 imageAssetId；工具不可用应记录失败，不能用提示词或计划冒充生成结果。'}
] as const;
export const WorkflowType=z.enum(['similarity','chart','formula','pages','image']);
export const WorkflowPage=z.object({pageId:z.string().regex(/^page_[a-f0-9]{32}$/),url:z.string().max(500),title:z.string().min(1).max(1000),blocks:z.array(z.object({id:z.string().min(1).max(200),kind:z.enum(['markdown','agent_instructions']),hash:z.string().min(1).max(200),markdown:z.string().max(2*1024*1024)})).max(2000),sequence:z.number().int().nonnegative().optional()}).strict();
export const WorkflowCitation=z.object({sourceId:z.string().min(1).max(180),start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(1).max(16000)}).strict();
export const WorkflowFinding=z.object({title:z.string().min(1).max(240),note:z.string().min(1).max(16000),presentation:CardPresentationSchema.optional(),category:z.enum(['similarity','difference','innovation','relation','derivation','evidence']),basis:z.enum(['reported','inference','hypothesis']),citations:z.array(WorkflowCitation).max(40)}).strict();
export const WorkflowResult=z.object({markdown:z.string().min(1).max(120000),citations:z.array(WorkflowCitation).max(100),findings:z.array(WorkflowFinding).max(30).optional(),page:WorkflowPage.optional(),imageAssetId:z.string().min(1).max(180).optional()}).strict();
export const WorkflowSchema=z.object({type:WorkflowType,prompt:z.string().max(8000),result:WorkflowResult.extend({taskId:z.string(),completedAt:z.string()}).optional()}).strict();
export type WorkflowKind=z.infer<typeof WorkflowType>;
// Geometry is excluded so a user can rearrange a live workflow without losing its result.
export function workflowScope(board:Board,nodeId:string){
 const target=board.nodes.find(n=>n.id===nodeId);if(!target?.workflow)throw Error('WORKFLOW_NODE: 请选择模板或输出节点');
 const visited=new Set<string>(),active=new Set<string>(),inputs:BoardNode[]=[];
 const visit=(id:string)=>{if(active.has(id))throw Error('WORKFLOW_CYCLE: 输入连接存在循环');if(visited.has(id))return;active.add(id);const n=board.nodes.find(n=>n.id===id)!;
  // Generated finding links describe provenance, including links saved before context edges existed.
  for(const e of board.edges.filter(e=>e.target===id&&e.kind!=='context'&&e.source!==n.workflowOrigin?.nodeId))visit(e.source);active.delete(id);visited.add(id);if(id!==nodeId)inputs.push(n);};visit(nodeId);
 if(!inputs.length)throw Error('INPUT_REQUIRED: 先把输入卡片连接到此节点');
 if(inputs.length>50)throw Error('INPUT_LIMIT: 单次最多连接 50 张上游卡片');
 for(const n of inputs)if(n.workflow&&!n.workflow.result)throw Error('DEPENDENCY_REQUIRED: 请先运行上游模板 '+n.title);
 const nodes=[...inputs,target],edges=board.edges.filter(e=>e.kind!=='context'&&visited.has(e.source)&&visited.has(e.target)&&e.source!==board.nodes.find(n=>n.id===e.target)?.workflowOrigin?.nodeId);
 const snapshot=JSON.stringify({nodes:nodes.map(n=>({id:n.id,title:n.title,note:n.note,...(n.presentation?{presentation:n.presentation}:{}),sourceId:n.sourceId,sourceRefs:n.sourceRefs,citations:n.citations,workflowOrigin:n.workflowOrigin,workflow:n.workflow?{type:n.workflow.type,prompt:n.workflow.prompt,...(n.id===nodeId?{}:{result:n.workflow.result})}:undefined})),edges:edges.map(e=>({id:e.id,source:e.source,target:e.target,label:e.label}))});
 const directIds=new Set(edges.filter(e=>e.target===nodeId).map(e=>e.source));
 return {node:target,inputs,directInputs:inputs.filter(n=>directIds.has(n.id)),edges,snapshot};
}
