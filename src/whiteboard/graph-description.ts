export function graphDescription(markdown:string){
 const body=markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').replace(/\[[^\]]*\]\(artinfact-pdf:\/\/[^)\r\n]*\)/g,'');
 const paragraphs:string[]=[];let current:string[]=[];
 const flush=()=>{if(current.length)paragraphs.push(current.join('\n'));current=[];};
 for(const line of body.split(/\r?\n/)){
  if(/^#{1,6}\s/.test(line)){flush();if(paragraphs.length)break;continue;}
  if(!line.trim()){flush();continue;}
  if(/^(?:[-*]\s|\d+\.\s|\[\[|!\[|\||<!--|原文字符偏移：|引句匹配：|MD:|workspaceId:|documentId:)/.test(line.trim())){flush();continue;}
  current.push(line.replace(/^>\s?/,''));
 }
 flush();return paragraphs.slice(0,3).join('\n\n');
}
