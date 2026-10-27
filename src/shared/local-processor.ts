export type LocalProcessorStatus={root:string;installed:boolean;error?:string;detail?:string;environmentOverride:boolean;progress?:{phase:string;label:string;log?:string;percent?:number;step?:string;completed?:number;total?:number}};
export const processorBusy=(value?:LocalProcessorStatus)=>['starting','installing','downloading','testing'].includes(value?.progress?.phase??'');
