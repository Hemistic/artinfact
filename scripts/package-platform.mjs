export function portableMcp(value) {
  const portable = structuredClone(value);
  const server = portable.mcpServers?.['work-layout'];
  if (!server) throw new Error('Missing Artinfact MCP server');
  Object.assign(server, {type:'stdio', command:'node', args:['${PLUGIN_ROOT}/dist/server/index.js'], env:{}});
  return portable;
}
export function packagePlatform(platform = process.platform, arch = process.arch) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Plugin packaging supports Windows and macOS');
  const native = `canvas-${platform}-${arch}${platform === 'win32' ? '-msvc' : ''}`;
  const required = [
    'dist/server/mineru-worker.js', 'dist/server/mineru-batch-worker.js', 'dist/server/pdf-metrics-worker.js', 'dist/server/pdf-evidence-worker.js',
    'vendor/mineru/runtime/client.cjs', 'vendor/mineru/runtime/layout.cjs', 'vendor/mineru/runtime/tree.cjs', 'vendor/mineru/PROVENANCE.json',
    `vendor/mineru/runtime/node_modules/@napi-rs/${native}/skia.${platform}-${arch}${platform === 'win32' ? '-msvc' : ''}.node`,
    'scripts/mineru-local/Install-MinerU.mjs',
  ];
  return { required, include(path) {
    if (/(^|\/)(?:\.context|\.preview-data|\.git|__pycache__)(?:\/|$)/.test(path)) return false;
    if (path.startsWith('vendor/yolo/') || /^(?:src\/(?:server|shared|ui)|dist\/server)\/yolo-[^/]+\.(?:ts|js)$/.test(path) || /^tests\/yolo-[^/]+\.test\.ts$/.test(path)) return false;
    const canvas = path.match(/^vendor\/mineru\/runtime\/node_modules\/@napi-rs\/(canvas-[^/]+)/);
    if (canvas && canvas[1] !== native) return false;
    if (platform === 'darwin' && /\.(?:exe|dll)$/i.test(path)) return false;
    return true;
  }};
}
