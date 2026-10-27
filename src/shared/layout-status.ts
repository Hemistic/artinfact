export type LayoutStatus = {
  phase: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  completedPages: number;
  totalPages: number;
  figures: number;
  tables: number;
  equations: number;
  error?: string;
  modelVersion: string;
  token?: string;
};
