import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packagePlatform,portableMcp} from '../scripts/package-platform.mjs';

test('redistributed MCP configuration never contains the tester executable, proxy or private environment',()=>{
 const local={mcpServers:{'work-layout':{type:'stdio',command:'/Users/test/.local/bin/node',args:['/Users/test/private/dist/server/index.js'],env:{HTTP_PROXY:'http://127.0.0.1:17890',PRIVATE_KEY:'secret'}}}};
 const portable=portableMcp(local);
 assert.equal(portable.mcpServers['work-layout'].command,'node');
 assert.deepEqual(portable.mcpServers['work-layout'].args,['${PLUGIN_ROOT}/dist/server/index.js']);
 assert.deepEqual(portable.mcpServers['work-layout'].env,{});
 assert.equal(local.mcpServers['work-layout'].command,'/Users/test/.local/bin/node');
});

test('Mac archives require their own native canvas and omit retired Windows binaries',()=>{
 const mac=packagePlatform('darwin','arm64');
 assert.ok(mac.required.includes('vendor/mineru/runtime/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node'));
 assert.equal(mac.include('vendor/yolo/runtime/doclayout_nano.onnx'),false);
 assert.equal(mac.include('vendor/yolo/runtime/lw-layout-detect.exe'),false);
 assert.equal(mac.include('vendor/mineru/runtime/node_modules/@napi-rs/canvas-win32-x64-msvc/package.json'),false);
 assert.equal(mac.include('vendor/mineru/runtime/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node'),true);
 assert.equal(mac.include('scripts/mineru-local/Install-MinerU.mjs'),true);
 assert.equal(mac.include('.context/private-test-data.json'),false);
 assert.equal(mac.include('.preview-data/test.json'),false);
});
test('all platforms omit the retired detector while retaining their own canvas and MinerU workers',()=>{
 const win=packagePlatform('win32','x64');
 for(const platform of [win,packagePlatform('darwin','arm64')]){
  assert.equal(platform.include('vendor/yolo/runtime/doclayout_nano.onnx'),false);
  assert.equal(platform.include('vendor/yolo/runtime/lw-layout-detect.exe'),false);
  assert.equal(platform.include('vendor/yolo/source/cmd/lw-layout-detect/main.go'),false);
  assert.equal(platform.include('dist/server/yolo-worker.js'),false);
  assert.ok(!platform.required.some(path=>/yolo/i.test(path)));
  assert.ok(platform.required.includes('dist/server/pdf-evidence-worker.js'));
  assert.ok(platform.required.includes('vendor/mineru/runtime/layout.cjs'));
 }
 assert.ok(win.required.includes('vendor/mineru/runtime/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node'));
 assert.equal(win.include('vendor/mineru/runtime/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node'),false);
});
