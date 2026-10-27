export const evidenceSentence='Retrieval improves factual accuracy.';
export function evidencePdf(title='Graph evidence navigation test'){
 const streams=[`BT /F1 20 Tf 72 700 Td (${title}) Tj 0 -40 Td /F1 12 Tf (The cited sentence is on PDF page two.) Tj ET`,`BT /F1 12 Tf 72 620 Td (${evidenceSentence}) Tj 0 -24 Td (This is the first evidence occurrence.) Tj 0 -276 Td (${evidenceSentence}) Tj 0 -24 Td (This repeated occurrence must be disambiguated.) Tj ET`];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',...streams.map((_,i)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents ${6+i} 0 R >>`),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',...streams.map(s=>`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`)];
 let pdf='%PDF-1.7\n';const offsets:number[]=[];for(const [i,o]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
