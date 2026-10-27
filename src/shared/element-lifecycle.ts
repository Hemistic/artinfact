type Watch = { element: HTMLElement; mounted: boolean; mount(): void; unmount(): void };
// Share one connection observer. Mutations inside an editor do not need to scan
// every other editor; only newly attached or removed roots can change lifetime.
const registries = new WeakMap<Document, ReturnType<typeof registry>>();
function registry(doc: Document) {
 const watches = new Set<Watch>(), waiting = new Set<Watch>(), candidates = new Set<Watch>();
 let scheduled = false;
 function schedule() { if (scheduled) return; scheduled = true; queueMicrotask(() => {
  scheduled = false;
  for (const watch of [...candidates]) {
   candidates.delete(watch); if (!watches.has(watch)) continue;
   if (!watch.mounted && watch.element.isConnected) { watch.mounted = true; waiting.delete(watch); watch.mount(); }
   else if (watch.mounted && !watch.element.isConnected) { watches.delete(watch); waiting.delete(watch); watch.unmount(); }
  }
  if (!watches.size) observer.disconnect();
 }); }
 const observer = new MutationObserver(records => {
  for (const watch of waiting) candidates.add(watch);
  for (const record of records) for (const removed of record.removedNodes) {
   if (removed.nodeType !== 1) continue;
   for (const watch of watches) if (watch.mounted && removed.contains(watch.element)) candidates.add(watch);
  }
  if (candidates.size) schedule();
 });
 return { add(element: HTMLElement, mount: () => void, unmount: () => void) {
  const watch: Watch = { element, mounted: false, mount, unmount };
  if (!watches.size) observer.observe(doc.documentElement, { childList: true, subtree: true });
  watches.add(watch); waiting.add(watch); candidates.add(watch); schedule();
  return () => { watches.delete(watch); waiting.delete(watch); candidates.delete(watch); if (!watches.size) observer.disconnect(); };
 } };
}
export function observeElementConnection(element: HTMLElement, mount: () => void, unmount: () => void) {
 let current = registries.get(element.ownerDocument);
 if (!current) { current = registry(element.ownerDocument); registries.set(element.ownerDocument, current); }
 return current.add(element, mount, unmount);
}
