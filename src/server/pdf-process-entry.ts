export const workerData: any = await new Promise(resolve => process.once('message', resolve));
export const parentPort = { postMessage(value: unknown, _transfer?: unknown[]) { process.send?.(value); } };
