import {z} from 'zod';
import {CitationSchema,type Source,type BoardNode} from './whiteboard-domain.js';
import {CardPresentationSchema} from './card-presentation-schema.js';
export const PdfPreprocessDraft=z.object({sourceId:z.string().min(1).max(180),title:z.string().min(1).max(240),note:z.string().min(1).max(12000),presentation:CardPresentationSchema.optional(),citations:z.array(CitationSchema).min(1).max(40)}).strict();
export const PdfPreprocessResult=PdfPreprocessDraft.extend({revision:z.string(),documentRevision:z.string(),taskId:z.string(),updatedAt:z.string()});
export const PdfPreprocessTask=z.object({id:z.string(),documentIds:z.array(z.string()),sourceIds:z.array(z.string()),sourceRevisions:z.record(z.string(),z.string()),documentRevisions:z.record(z.string(),z.string()),processedIds:z.array(z.string()),status:z.enum(['queued','running','completed','failed','cancelled']),message:z.string(),createdAt:z.string()});
export type PreprocessDraft=z.infer<typeof PdfPreprocessDraft>;
export type PreprocessResult=z.infer<typeof PdfPreprocessResult>;
export type PreprocessTask=z.infer<typeof PdfPreprocessTask>;
export type PreprocessInput={source:Source;text:string|undefined;revision:string;documentRevision:string};
export function cachedPreprocessing(results:PreprocessResult[],input:PreprocessInput){return results.find(r=>r.sourceId===input.source.id&&r.revision===input.revision&&r.documentRevision===input.documentRevision);}
export function preprocessedCard(source:Source,result:PreprocessResult):BoardNode{
 return {id:'source-'+source.id,title:result.title,note:result.note,...(result.presentation?{presentation:result.presentation}:{}),citations:result.citations,sourceId:source.id,kind:'note',role:'source',basis:'reported',createdBy:'agent',updatedBy:'agent',x:0,y:0,width:420,height:200,autoHeight:true};
}
