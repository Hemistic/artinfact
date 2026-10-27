import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import type { WorkspaceLibrary } from './workspaces.js';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

function imageReferences(text: string) {
  const tree = unified().use(remarkParse).parse(text);
  const references: { url: string; start: number; end: number }[] = [];
  const definitions = new Set<string>();
  const visit = (node: any, callback: (node: any) => void) => { callback(node); for (const child of node.children ?? []) visit(child,callback); };
  visit(tree,node=>{if(node.type==='imageReference')definitions.add(node.identifier);});
  visit(tree,node=>{
    const start=node.position?.start.offset,end=node.position?.end.offset;if(start===undefined||end===undefined)return;
    const raw=text.slice(start,end);
    if(node.type==='image'||(node.type==='definition'&&definitions.has(node.identifier))) {
      const prefix=node.type==='image'?raw.lastIndexOf('](')+2:raw.indexOf(']:')+2;
      for(const candidate of [node.url,node.url?.replace(/[()]/g,'\\$&')]) {const offset=raw.indexOf(candidate,prefix);if(offset>=0){references.push({url:node.url,start:start+offset,end:start+offset+candidate.length});break;}}
    } else if(node.type==='html') {
      for(const tag of raw.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
        for(const match of tag[0].matchAll(/\b(src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
          const value=match[2]??match[3],base=start+tag.index!+match.index!+match[0].indexOf(value);
          if(match[1].toLowerCase()==='src')references.push({url:value,start:base,end:base+value.length});
          else if(!/^data:/i.test(value))for(const item of value.matchAll(/(?:^|,\s*)([^\s,]+)(?:\s+[^,]+)?/g)){const url=item[1],offset=item.index!+item[0].indexOf(url);references.push({url,start:base+offset,end:base+offset+url.length});}
        }
      }
    }
  });return references;
}

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export function markdownText(name: string, bytes: Buffer) {
  if (basename(name) !== name || /[<>:"\\/\u0000-\u001f]/.test(name) || !/\.md$/i.test(name) || name.length > 140) throw new Error('无效的 Markdown 文件名');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('无效的 Markdown 文件名');
  if (bytes.length > MAX_MARKDOWN_BYTES) throw new Error('Markdown 不能超过 2 MB');
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw new Error(); return text; }
  catch { throw new Error('请选择 UTF-8 编码的 Markdown 文本'); }
}
export async function importMarkdown(library: WorkspaceLibrary, workspaceId: string, name: string, bytes: Buffer) {
  const text = markdownText(name, bytes);
  return library.importNote(workspaceId, name, text);
}
export async function importMarkdownPath(library: WorkspaceLibrary, workspaceId: string, path: string) {
  if (!isAbsolute(path) || !(await stat(path)).isFile() || (await stat(path)).size > MAX_MARKDOWN_BYTES) throw new Error('请选择不超过 2 MB 的 Markdown 绝对路径');
  let text = markdownText(basename(path), await readFile(path));
  const root = await realpath(dirname(path));
  const replacements: { start: number; end: number; value: string }[] = [];
  for (const reference of imageReferences(text)) {
    const href = reference.url; if (/^(?:[a-z]+:|\/|#)/i.test(href)) continue;
    try {
      const local = await realpath(resolve(root, decodeURIComponent(href))); const rel = relative(root, local);
      if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) continue;
      const kind = ({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' } as Record<string, string>)[extname(local).toLowerCase()];
      if (!kind || !(await stat(local)).isFile() || (await stat(local)).size > 8 * 1024 * 1024) continue;
      const asset = await library.saveNoteAsset(workspaceId, `data:image/${kind};base64,${(await readFile(local)).toString('base64')}`);
      replacements.push({ start:reference.start,end:reference.end,value:asset.path });
    } catch { /* Keep missing image references so the source can be repaired. */ }
  }
  for (const replacement of replacements.sort((a,b)=>b.start-a.start)) text=text.slice(0,replacement.start)+replacement.value+text.slice(replacement.end);
  return library.importNote(workspaceId, basename(path), text);
}
