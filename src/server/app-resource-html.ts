import {gzipSync} from 'node:zlib';

// Keep each MCP resource response below the desktop transport's large-message boundary.
export function compressedAppHtml(html:string){
 const packed=gzipSync(html).toString('base64');
 return `<!doctype html><html><head><meta charset="utf-8"></head><body><p role="status">Loading Artinfact…</p><script>(async()=>{const bytes=Uint8Array.from(atob('${packed}'),c=>c.charCodeAt(0));const html=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();document.open();document.write(html);document.close();})().catch(error=>{document.body.textContent='Unable to load Artinfact: '+error.message;});</script></body></html>`;
}
