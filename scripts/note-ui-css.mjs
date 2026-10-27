import {build} from 'esbuild';
export async function noteUiStyles(){const result=await build({entryPoints:['src/whiteboard/note-ui-theme.css'],bundle:true,write:false,minify:true,logLevel:'silent',plugins:[{name:'shared-katex-fonts',setup(builder){
 // The whiteboard already embeds KaTeX and its fonts through katexStyles().
 builder.onResolve({filter:/^katex\/dist\/katex\.min\.css$/},()=>({path:'katex',namespace:'shared-katex'}));builder.onLoad({filter:/.*/,namespace:'shared-katex'},()=>({contents:'',loader:'css'}));
}}]});return result.outputFiles[0].text;}
