type Item={str:string;width:number;height:number;transform:number[]};
export function titlePageMetadata(items:Item[],pageHeight:number){
 const lines:{y:number;font:number;items:Item[]}[]=[];
 for(const item of items){if(!item.str.trim()||Math.abs(item.transform[1])>.5||Math.abs(item.transform[2])>.5||item.transform[5]<pageHeight*.5)continue;
  const y=item.transform[5],line=lines.find(line=>Math.abs(line.y-y)<3);if(line){line.items.push(item);line.font=Math.max(line.font,item.height);}else lines.push({y,font:item.height,items:[item]});
 }
 const textLines=lines.sort((a,b)=>b.y-a.y).map(line=>{const ordered=line.items.sort((a,b)=>a.transform[4]-b.transform[4]);let text='',right=0;
  for(const item of ordered){if(text&&item.transform[4]-right>Math.max(2,item.height*.22)&&!text.endsWith(' ')&&!item.str.startsWith(' '))text+=' ';text+=item.str;right=item.transform[4]+item.width;}
  return {...line,text:text.replace(/[†‡§∗*]/g,'').replace(/\s+/g,' ').replace(/\s+([,;:])/g,'$1').trim()};
 });
 const candidates=textLines.filter(line=>line.text.length>=12&&!/^(arxiv|preprint|accepted|published|proceedings|international conference)/i.test(line.text));
 const largest=Math.max(0,...candidates.map(line=>line.font));if(largest<12)return {title:'',author:''};
 const first=textLines.findIndex(line=>candidates.includes(line)&&line.font>=largest*.95);if(first<0)return {title:'',author:''};
 const headings=[textLines[first]];let end=first;
 while(textLines[end+1]&&textLines[end+1].font>=largest*.88&&textLines[end].y-textLines[end+1].y<largest*2.5){headings.push(textLines[++end]);}
 const title=headings.map(line=>line.text).join(' ').slice(0,500),names:string[]=[];
 for(const line of textLines.slice(end+1,end+12)){
  if(/abstract|摘要|introduction|引言|university|institute|department|laboratory|research|school|college|@|https?:|\.edu\b|大学|学院|研究院/i.test(line.text))break;
  if(!/[\p{L}]/u.test(line.text)||line.font<largest*.45)continue;
  if(line.text.length>180||!(/^[A-Z][\p{L}.'’ -]+(?:[,，;]|\band\b|$)/u.test(line.text)||/^[\p{Script=Han}]{2,4}(?:[,，、 ]+[\p{Script=Han}]{2,4})*$/u.test(line.text)))break;
  let nameText='',right=0;for(const item of line.items.filter(item=>item.height>=line.font*.8)){const gap=item.transform[4]-right;if(nameText&&gap>line.font*.7&&!/[,;]\s*$/.test(nameText))nameText+=', ';else if(nameText&&gap>Math.max(2,line.font*.22)&&!nameText.endsWith(' ')&&!item.str.startsWith(' '))nameText+=' ';nameText+=item.str;right=item.transform[4]+item.width;}
  names.push(nameText.replace(/[\d†‡§∗*]+/g,'').replace(/\s+([,;])/g,'$1').replace(/(?:,\s*){2,}/g,', ').replace(/\s+/g,' ').replace(/^[,; ]+|[,; ]+$/g,'').trim());
 }
 return {title,author:names.join(', ').slice(0,500)};
}
