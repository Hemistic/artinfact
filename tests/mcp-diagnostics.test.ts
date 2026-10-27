import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMcpDiagnostics} from '../src/server/mcp-diagnostics.ts';
test('MCP lifecycle diagnostics redact credentials and never write protocol stdout',()=>{
 const log=createMcpDiagnostics(mkdtempSync(join(tmpdir(),'artinfact-mcp-log-')),'test');
 log.record('transport-error',Error('Bearer secret-value sk-test-12345'));
 const value=readFileSync(log.path,'utf8');assert.match(value,/transport-error/);assert.doesNotMatch(value,/secret-value|sk-test/);
});
