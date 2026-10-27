import {build} from 'esbuild';
export async function uiAffordancesStyles(){
 const result=await build({entryPoints:['src/shared/ui-affordances.ts'],bundle:true,write:false,platform:'node',format:'esm',minify:true,logLevel:'silent'});
 const module=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 return module.uiAffordancesCss();
}
