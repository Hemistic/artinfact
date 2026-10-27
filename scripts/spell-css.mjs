import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {transform} from 'esbuild';

export async function spellStyles(){
 const input=resolve('src/ui/spell.css');
 const compiler=await compile(await readFile(input,'utf8'),{base:dirname(input),from:input,onDependency(){}});
 // Scan the installed component content explicitly. Directory scanning may skip
 // an ignored or hidden checkout such as .context, leaving only an empty layer.
 const candidates=new Scanner({sources:[]}).scanFiles([{content:await readFile('src/ui/components/perspective-book.tsx','utf8'),extension:'tsx'}]);
 const css=(await transform(compiler.build(candidates),{loader:'css',minify:true,target:'es2022'})).code.trim();
 for(const required of [/aspect-ratio:\s*49\s*\/\s*60/,/perspective:\s*900px/,/position:\s*absolute/,/transform-style:\s*preserve-3d/])if(!required.test(css))throw Error('Spell UI book geometry was not compiled');
 return css;
}
