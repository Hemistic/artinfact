import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export function initializePdfCanvas(){
 // CJS PDF.js cannot use import.meta to install these globals itself.
 const canvas=createRequire(import.meta.url)(fileURLToPath(new URL('../../vendor/mineru/runtime/node_modules/@napi-rs/canvas/index.js',import.meta.url)));
 for(const key of ['DOMMatrix','Path2D','ImageData'])(globalThis as any)[key]=canvas[key];
}
