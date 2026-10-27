import {readFile} from 'node:fs/promises';
export async function katexStyles(){
 let css=await readFile('node_modules/katex/dist/katex.min.css','utf8');
 for(const face of [...css.matchAll(/@font-face\{[^}]+\}/g)]){
  const path=/url\((fonts\/[^)]+\.woff2)\)/.exec(face[0])?.[1];
  if(!path)throw Error('KaTeX font lacks WOFF2');
  const bytes=await readFile('node_modules/katex/dist/'+path);
  css=css.replace(face[0],face[0].replace(/src:[^}]+/,()=>`src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2")`));
 }
 if(/url\((?!data:)/.test(css))throw Error('KaTeX fonts must be self-contained');
 return css;
}
