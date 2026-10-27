type Annotation = {id:string;[key:string]:unknown};
export function layoutPreviewAnnotation<T extends Record<string,unknown>>(annotation:T):T{
 // Presentation only: keep the saved source and any user-written explanation intact.
 const generated=annotation.projectOrigin==='layout-json'&&annotation.layoutKind==='equation'&&typeof annotation.layoutOriginalComment==='string'&&annotation.comment===annotation.layoutOriginalComment;
 return generated?{...annotation,comment:''}:annotation;
}
export function layoutAnnotationEdited(annotation:Record<string,unknown>){
 // Keep historical origin tags solely to preserve saved user edits during MinerU replacement.
 return annotation.dateModified!==annotation.dateCreated || (Object.hasOwn(annotation,'layoutOriginalComment') ? annotation.comment!==annotation.layoutOriginalComment : annotation.projectOrigin==='layout-yolo' && !!annotation.comment);
}
export function replacedLayoutIds(current:Annotation[],next:Annotation[]){
 const ids=new Set(next.map(annotation=>annotation.id));
 return current.filter(annotation=>['layout-json','layout-yolo'].includes(String(annotation.projectOrigin))&&!layoutAnnotationEdited(annotation)&&!ids.has(annotation.id)).map(annotation=>annotation.id);
}
