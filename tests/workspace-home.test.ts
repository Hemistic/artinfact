import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedHomeWorkspace} from '../src/shared/workspace-home.js';

const workspaces=[
 {id:'first',documents:[{id:'first-pdf'}],notes:[{name:'first-note.md'}]},
 {id:'second',documents:[{id:'second-pdf'}],notes:[]},
];
test('homepage follows the selected workspace and exposes only its books',()=>{
 const first=selectedHomeWorkspace({workspaces,activeWorkspaceId:'first'},'first');
 const second=selectedHomeWorkspace({workspaces,activeWorkspaceId:'first'},'second');
 assert.deepEqual(first?.documents.map(d=>d.id),['first-pdf']);
 assert.deepEqual(second?.documents.map(d=>d.id),['second-pdf']);
 assert.equal(second?.id,'second');
 assert.equal(second?.notes.length,0);
});
test('initial loading and archived selection fall back to the active workspace',()=>{
 const snapshot={workspaces,activeWorkspaceId:'second'};
 assert.equal(selectedHomeWorkspace(snapshot,'')?.id,'second');
 assert.equal(selectedHomeWorkspace(snapshot,'archived')?.id,'second');
 assert.equal(selectedHomeWorkspace({...snapshot,activeWorkspaceId:'missing'},'')?.id,'first');
 assert.equal(selectedHomeWorkspace({workspaces:[],activeWorkspaceId:''},''),undefined);
});
