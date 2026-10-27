import type {PdfPatch} from '../server/pdf-store.js';
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export type PdfSaveIntent = {id:string;workspaceId?:string;patch:PdfPatch};
type Entry = PdfSaveIntent & {key:string;createdAt:number};
export class PdfSaveOutbox {
  readonly storageKey:string;
  pending:Entry[]=[];
  durable=true;
  constructor(private storage:Storage,root:string) {
    this.storageKey='artinfact:pdf-pending:v1:'+root.replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
    this.pending=this.read();
  }
  private read():Entry[] {
    const text=this.storage.getItem(this.storageKey);if(!text)return [];
    const value=JSON.parse(text);
    if(!Array.isArray(value)||value.some(v=>!v||typeof v.key!=='string'||typeof v.createdAt!=='number'||!/^[a-f0-9]{64}$/.test(v.id)||!v.patch||typeof v.patch!=='object'))throw Error('待保存批注缓存无效，原缓存已保留');
    return value;
  }
  private persist(removed?:string) {
    try {
      // Read again before committing so an acknowledgement does not erase another window’s drafts.
      const entries=new Map(this.read().filter(e=>e.key!==removed).map(e=>[e.key,e]));
      for(const entry of this.pending)entries.set(entry.key,entry);
      const value=[...entries.values()].sort((a,b)=>a.createdAt-b.createdAt);
      if(value.length)this.storage.setItem(this.storageKey,JSON.stringify(value));else this.storage.removeItem(this.storageKey);
      this.durable=true;
    }catch {this.durable=false;}
  }
  push(intent:PdfSaveIntent):Entry {
    const entry={...structuredClone(intent),key:crypto.randomUUID(),createdAt:Date.now()};this.pending.push(entry);this.persist();return entry;
  }
  ack(key:string) {this.pending=this.pending.filter(e=>e.key!==key);this.persist(key);}
}
