import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export async function researchArtifactsFingerprint(result:{directory:string;format?:string}) {
 const missing='AI 大纲和 AI 洞察需要同源 Markdown 和结构 JSON。请先点击“布局解析”完成本机 MinerU 标准解析；已有分析保留。';
 if(result.format==='markdown-only')throw new Error(missing);
 let markdown:Buffer,json:Buffer;
 try {[markdown,json]=await Promise.all([readFile(join(result.directory,'document-mineru.md')),readFile(join(result.directory,'document-mineru.json'))]);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new Error(missing);throw error;}
 if(!markdown.toString('utf8').trim())throw new Error('MinerU Markdown 为空，请重新布局解析；已有分析保留。');
 let parsed:any;try{parsed=JSON.parse(json.toString('utf8'));}catch{throw new Error('MinerU 结构 JSON 无效，请重新布局解析；已有分析保留。');}
 const blocks=Array.isArray(parsed)?parsed:parsed?.pdf_info??parsed?.pages;
 if(!Array.isArray(blocks)||!blocks.length)throw new Error('MinerU 结构 JSON 无效或为空，请重新布局解析；已有分析保留。');
 return createHash('sha256').update(JSON.stringify(result)).update('\0').update(markdown).update('\0').update(json).digest('hex');
}
