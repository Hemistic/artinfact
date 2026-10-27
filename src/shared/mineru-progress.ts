import type { AnalysisStatus } from './mineru.js';
import { mineruFailure } from './mineru-failure.js';
import type { LayoutStatus } from './layout-status.js';
import {processorBusy,type LocalProcessorStatus} from './local-processor.js';
export type MineruProgress = { state: 'idle' | 'busy' | 'completed' | 'failed'; busy: boolean; indeterminate: boolean; percent: number | null; label: string; canRetryPipeline: boolean };
const stages = { idle: 'MinerU 解析菜单', receiving: '传输 PDF 到本机', creating: '创建 MinerU 任务', uploading: '上传 PDF', parsing: 'MinerU 正在解析', downloading: '下载转换产物', indexing: '生成图表框和内容结构', completed: 'MinerU 转换完成', failed: 'MinerU 转换失败' };
export function mineruProgress(status?: AnalysisStatus): MineruProgress {
  const phase = status?.phase ?? 'idle'; const busy = !['idle', 'completed', 'failed'].includes(phase);
  const count = status?.progress?.extractedPages; const total = status?.progress?.totalPages;
  const known = phase === 'parsing' && (!status?.upstreamState || status.upstreamState === 'running') && typeof count === 'number' && Number.isFinite(count) && count >= 0 && typeof total === 'number' && Number.isFinite(total) && total > 0;
  const native=status?.progress?.percent;
  const percent = phase === 'completed' ? 100 : typeof native==='number'&&Number.isFinite(native)&&native>=0&&native<=100?Math.round(native):known ? Math.round(Math.max(0, Math.min(100, count / total * 100))) : null;
  const failure = mineruFailure(status);
  const label = phase === 'failed' ? `${stages.failed}：${failure.message}` : `${status?.label || stages[phase]}${status?.progress?.step?` · ${status.progress.step} ${percent??'…'}%`:known ? ` · ${percent}%（${count}/${total} 页）` : ''}`;
  return { state: busy ? 'busy' : phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : 'idle', busy, indeterminate: busy && percent === null, percent, label, canRetryPipeline: failure.canRetryPipeline };
}
export function combinedMineruProgress(status?:AnalysisStatus,layout?:LayoutStatus,processor?:LocalProcessorStatus):MineruProgress&{shortLabel:string} {
 if(processorBusy(processor)){
  const p=processor!.progress!,percent=typeof p.percent==='number'&&p.percent>=0&&p.percent<=100?Math.round(p.percent):null;
  const phase={starting:'启动部署',installing:'安装基础环境',downloading:'下载模型',testing:'部署测试'}[p.phase]??p.label;
  return {state:'busy',busy:true,indeterminate:percent===null,percent,label:`${phase}${p.step?` · ${p.step}`:''}${percent!==null?` ${percent}%（当前步骤）`:''} · 可在后台继续`,shortLabel:p.phase==='downloading'?'下':p.phase==='testing'?'测':'装',canRetryPipeline:false};
 }
 if(status&&!['idle','failed','completed'].includes(status.phase))return {...mineruProgress(status),shortLabel:'析'};
 if(layout&&['queued','running'].includes(layout.phase))return {state:'busy',busy:true,indeterminate:true,percent:null,label:'MinerU 布局解析中 · 后台运行',shortLabel:'析',canRetryPipeline:false};
 if(status?.phase==='failed'){const failure=mineruProgress(status);return {...failure,label:failure.label+(layout?.phase==='completed'?' · 已有布局 JSON 仍可用':''),shortLabel:''};}
 if(layout?.phase==='failed')return {state:'failed',busy:false,indeterminate:false,percent:null,label:'MinerU 布局解析失败：'+(layout.error??'请重试'),shortLabel:'',canRetryPipeline:false};
 if(processor?.progress?.phase==='failed')return {state:'failed',busy:false,indeterminate:false,percent:null,label:'MinerU 部署失败：'+processor.progress.label,shortLabel:'',canRetryPipeline:false};
 if(layout?.phase==='completed')return {state:'completed',busy:false,indeterminate:false,percent:100,label:'布局 JSON 已就绪 · 点击直接使用缓存',shortLabel:'',canRetryPipeline:false};
 return {...mineruProgress(status),shortLabel:''};
}
