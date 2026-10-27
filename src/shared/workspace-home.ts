export function selectedHomeWorkspace<T extends {id:string}>(snapshot:{workspaces:T[];activeWorkspaceId:string},selectedId:string):T|undefined {
 return snapshot.workspaces.find(w=>w.id===selectedId)
  ??snapshot.workspaces.find(w=>w.id===snapshot.activeWorkspaceId)
  ??snapshot.workspaces[0];
}
