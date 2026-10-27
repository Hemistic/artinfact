import { fork, type ForkOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Native PDF/canvas modules can crash during Windows worker-thread teardown.
// A separate process keeps that failure outside the MCP connection.
export function isolatedPdfTask(url: URL, data: object, timeoutMs: number, progress?: (value: any) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const options: ForkOptions & { windowsHide: boolean } = { serialization: 'advanced', execArgv: ['--max-old-space-size=768'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true };
    const child = fork(fileURLToPath(url), [], options);
    child.stdout?.resume(); child.stderr?.resume();
    let settled = false; const finish = (error?: Error, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error('PDF 处理超时，请缩小范围后重试')), timeoutMs);
    child.once('error', finish); child.once('exit', (code, signal) => finish(new Error(`PDF 子进程提前退出（${code ?? signal}），已保留原文件`)));
    child.on('message', (message: any) => { if (message?.progress) { progress?.(message.progress); return; } finish(message?.error ? new Error(message.error) : undefined, message); });
    child.send(data, error => { if (error) finish(error); });
  });
}
