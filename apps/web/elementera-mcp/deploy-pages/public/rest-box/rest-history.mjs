// Read-only projections; source access is supplied by the authenticated adapter.
export function readCycleHistory(state,visibleWindowIds,{limit=20,before=null}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid cycle limit');
  if(before&&(!Number.isSafeInteger(before.at)||typeof before.id!=='string'))throw Error('invalid cycle cursor');
  const visible=new Set(visibleWindowIds),notes=new Map(state.notes.map(n=>[n.id,n]));
  const copy=x=>JSON.parse(JSON.stringify(x));
  const boundary=b=>{if(!b)return null;if(!visible.has(b.source.windowId))return {restricted:true};const n=notes.get(b.noteId);return {...copy(b),note:n&&visible.has(n.source.windowId)?copy(n):null}};
  const rows=state.cycles.filter(c=>visible.has(c.entry.source.windowId)||(c.exit&&visible.has(c.exit.source.windowId))||c.events.some(e=>visible.has(e.windowId)))
    .map(c=>({c,at:Math.max(...[c.entry,c.exit].filter(b=>b&&visible.has(b.source.windowId)).map(b=>b.source.at),...c.events.filter(e=>visible.has(e.windowId)).map(e=>e.at))}))
    .sort((a,b)=>b.at-a.at||(a.c.id===b.c.id?0:a.c.id>b.c.id?-1:1))
    .filter(r=>!before||r.at<before.at||r.at===before.at&&r.c.id<before.id);
  const page=rows.slice(0,limit),last=page.at(-1);
  return {items:page.map(({c})=>{const entry=boundary(c.entry),exit=boundary(c.exit);if(entry.restricted&&exit)delete exit.elapsedMs;return {id:c.id,active:c.id===state.activeCycleId,entry,exit,events:c.events.filter(e=>visible.has(e.windowId)).map(copy)}}),next:rows.length>limit?{at:last.at,id:last.c.id}:null};
}
export function noteSourceLink(note,resolveSource){
  if(!note?.source||typeof resolveSource!=='function')return null;
  const s=note.source;
  return resolveSource({windowId:s.windowId,turnId:s.turnId,messageIds:[...s.messageIds]})??null;
}
