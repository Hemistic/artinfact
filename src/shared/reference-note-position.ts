import type {CitationRect} from './pdf-citations.js';
export function referenceNoteRect(chars:{rect?:number[];inlineRect?:number[]}[],page:number[],marker:{rects:number[][];sourceRect?:number[]},occupied:number[][]=[]):CitationRect|undefined{
 const size=22,padding=2,first=marker.rects[0];if(page.length!==4||!first||![...page,...first].every(Number.isFinite)||page[2]-page[0]<size+8||page[3]-page[1]<size+8)return;
 const box=marker.sourceRect??first,obstacles=[...chars.map(c=>c.inlineRect??c.rect),...occupied].filter((r):r is number[]=>!!r&&r.length===4&&r.every(Number.isFinite)),center=(first[1]+first[3])/2;
 for(const dy of [0,26,-26,52,-52,78,-78])for(const x of [box[2]+padding,box[0]-padding-size,page[2]-size-8,page[0]+8]){
  const y=Math.max(page[1]+4,Math.min(center+dy-size/2,page[3]-size-4)),rect:CitationRect=[x,y,x+size,y+size];if(rect[0]<page[0]+4||rect[2]>page[2]-4)continue;
  if(!obstacles.some(r=>rect[0]<r[2]+padding&&rect[2]>r[0]-padding&&rect[1]<r[3]+padding&&rect[3]>r[1]-padding))return rect;
 }
}
