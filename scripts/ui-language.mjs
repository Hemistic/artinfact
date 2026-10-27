import ts from'typescript';import{readFile}from'node:fs/promises';import{resolve}from'node:path';
export function localizedUiSource(source,path){
 const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),changes=[];
 function visit(node){
  if(ts.isFunctionDeclaration(node)&&/prompt/i.test(node.name?.text??''))return;
  if(ts.isPropertyAssignment(node)&&/prompt/i.test(node.name.getText(tree)))return;
  if(ts.isPropertyAccessExpression(node)&&node.name.text==='message'&&!(ts.isBinaryExpression(node.parent)&&node.parent.left===node)){
   changes.push({start:node.getStart(tree),end:node.end,text:'__artinfactUiMessage('+source.slice(node.getStart(tree),node.end)+')'});return;
  }
  if(ts.isStringLiteralLike(node)&&/[\u3400-\u9fff]/.test(node.text)){
   const parent=node.parent;if(node.text.length>300&&/(Agent|MCP|pdf_|whiteboard_|wiki_)/.test(node.text)||ts.isLiteralTypeNode(parent)||ts.isImportDeclaration(parent)||ts.isExportDeclaration(parent)||(ts.isPropertyAssignment(parent)&&parent.name===node)||ts.isElementAccessExpression(parent)&&parent.argumentExpression===node)return;
   changes.push({start:node.getStart(tree),end:node.end,text:'__artinfactUiText('+JSON.stringify(node.text)+')'});return;
  }
  if(ts.isTemplateExpression(node)){
   if(/[\u3400-\u9fff]/.test([node.head.text,...node.templateSpans.map(s=>s.literal.text)].join(''))){
    const terms=[node.head,...node.templateSpans.map(s=>s.literal)].map(n=>/[\u3400-\u9fff]/.test(n.text)?'__artinfactUiText('+JSON.stringify(n.text)+')':JSON.stringify(n.text));let text=terms[0];node.templateSpans.forEach((span,i)=>{text+=' + ('+localizedUiSource(source.slice(span.expression.getStart(tree),span.expression.end),path).body+') + '+terms[i+1];});changes.push({start:node.getStart(tree),end:node.end,text:'('+text+')'});return;
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);let body=source;for(const change of changes.sort((a,b)=>b.start-a.start))body=body.slice(0,change.start)+change.text+body.slice(change.end);
 return{body,changed:changes.length>0};
}
export function uiLanguagePlugin(){return{name:'artinfact-ui-language',setup(build){build.onLoad({filter:/\.(?:ts|tsx)$/},async({path})=>{const normalized=path.replaceAll('\\','/');if(!/\/src\/(?:ui|whiteboard|shared)\//.test(normalized)||/ui-language(?:-en)?\./.test(normalized)||normalized.endsWith('/version.ts'))return;const source=await readFile(path,'utf8'),result=localizedUiSource(source,path);if(!result.changed)return;return{contents:'import {uiText as __artinfactUiText,uiMessage as __artinfactUiMessage} from '+JSON.stringify(resolve('src/ui/ui-language.ts'))+';\n'+result.body,loader:path.endsWith('tsx')?'tsx':'ts',resolveDir:resolve(path,'..')};});}};}
