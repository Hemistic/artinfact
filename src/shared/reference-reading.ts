export type ReadingCoverage={paperHash:string;total:number;ranges:[number,number][]};
export function extendReading(previous:ReadingCoverage|undefined,paperHash:string,total:number,start:number,end:number):ReadingCoverage{
 const ranges:ReadingCoverage['ranges']=[];for(const range of [...(previous?.paperHash===paperHash&&previous.total===total?previous.ranges:[]),[start,end] as [number,number]].sort((a,b)=>a[0]-b[0])){const last=ranges.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else if(range[1]>range[0])ranges.push([...range]);}return {paperHash,total,ranges};
}
export function readingProgress(coverage:ReadingCoverage){const readCharacters=coverage.ranges.reduce((sum,[start,end])=>sum+end-start,0);return{readCharacters,total:coverage.total,complete:coverage.ranges.length===1&&coverage.ranges[0][0]===0&&coverage.ranges[0][1]===coverage.total};}
export type ReferenceQuote={start:number;end:number;quote:string};
export type ReadingAnnotation=ReferenceQuote&{section:string;comment:string};
export function verifyReferenceQuotes(text:string,quotes:ReferenceQuote[]){
 for(const c of quotes)if(!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end<=c.start||c.quote.length<24||c.quote.length>2000||text.slice(c.start,c.end)!==c.quote)throw Error('citation 原文依据不一致');
}
export function fullReadingNote(markdown:string,annotations:ReadingAnnotation[],source?:string,language:'zh'|'en'='zh'){return markdown+'\n\n## '+(language==='en'?'Source annotations':'原文批注')+'\n\n'+annotations.map(a=>'### '+a.section+'\n\n'+a.comment+'\n\n> '+a.quote.replace(/\n/g,'\n> ')).join('\n\n')+(source?'\n\n['+(language==='en'?'Paper source':'论文来源')+']('+source+')\n':'\n');}
