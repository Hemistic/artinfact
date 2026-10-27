export type WorkspaceGraphMode='constellation'|'editor';
export const workspaceKnowledgeEntries=[
 {title:'图谱',description:'探索节点、证据与论文之间的关系',mode:'constellation',openData:false,icon:'dots'},
 {title:'白板',description:'在自由画布中整理笔记、资料与连接',mode:'editor',openData:false,icon:'canvas'},
] as const;
