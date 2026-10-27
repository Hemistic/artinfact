const clean=(value:string|undefined)=>value?.replace(/\s+/g,' ').trim()??'';
export function validBookTitle(value:string|undefined,name=''){const title=clean(value);return !!title&&title!==name&&!/\.(pdf|epub)$/i.test(title)&&!/^(untitled|unknown|document|microsoft word.*|latex.*|default)$/i.test(title);}
export function validBookAuthor(value:string|undefined){const author=clean(value);return !!author&&!/^(unknown|untitled|latex.*|microsoft word.*|pdf|default)$/i.test(author)&&!/hyperref/i.test(author);}
export function bookMetadata(doc:{name:string;title?:string;author?:string}){return {title:validBookTitle(doc.title,doc.name)?clean(doc.title):doc.name.replace(/\.(pdf|epub)$/i,''),author:validBookAuthor(doc.author)?clean(doc.author):''};}
