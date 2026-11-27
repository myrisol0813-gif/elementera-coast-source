// Pure note and cycle transaction proposal. Persistence must enforce revision CAS and authenticated source / permissions. No model calls or storage.
function assertRule(ok,message){if(!ok)throw Error(message)}

function id(v){return typeof v==="string"&&v.length>0&&v.length<=200&&!/[\x00-\x1f]/.test(v)&&!["__proto__","prototype","constructor"].includes(v)}

function string(v){return typeof v==="string"&&v.trim().length>0}

function time(v){return Number.isSafeInteger(v)&&v>=0}

function range(value={}){const min=value.min??null,max=value.max??null;assertRule([min,max].every(v=>v===null||Number.isSafeInteger(v)&&v>0)&&(min===null||max===null||min<=max),"invalid writing interval");return {min,max}}

function settings(raw={}){const limit=raw.readLimit??5;assertRule(Number.isSafeInteger(limit)&&limit>0&&limit<=100,"invalid read limit");return {ordinaryEnabled:raw.ordinaryEnabled===true,restEnabled:raw.restEnabled===true,ordinary:range(raw.ordinary),enter:range(raw.enter),exit:range(raw.exit),readLimit:limit}}

function eligible(count,interval){assertRule(Number.isSafeInteger(count)&&count>=0,"invalid round count");const r=range(interval);return {allowed:r.min===null||count>=r.min,due:r.max!==null&&count>=r.max}}

function initialNotes(){return {version:1,revision:0,activeCycleId:null,notes:[],cycles:[]}}

function sourceOf(context,refs){assertRule(id(context.requestId)&&id(context.windowId)&&string(context.windowName)&&string(context.modelId)&&id(context.turnId)&&time(context.at),"invalid trusted call context");const allowed=new Set(context.allowedMessageIds??[]);assertRule(Array.isArray(refs)&&refs.every(x=>id(x)&&allowed.has(x))&&new Set(refs).size===refs.length,"unverified source messages");return {windowId:context.windowId,windowName:context.windowName,modelId:context.modelId,turnId:context.turnId,at:context.at,messageIds:[...refs]}}

function tagsOf(t){assertRule(t&&string(t.emotion)&&string(t.energy)&&t.emotion.length<=80&&t.energy.length<=80,"two state tags required");return {emotion:t.emotion,energy:t.energy}}

function activeCycle(state){return state.cycles.find(c=>c.id===state.activeCycleId)??null}

function commandFingerprint(proposal,source){return JSON.stringify([proposal.body,proposal.ordinary===true,proposal.action??null,proposal.tags?.emotion??null,proposal.tags?.energy??null,proposal.reason??null,source.windowId,source.modelId,source.turnId,source.messageIds])}

function writeNote(state,config,proposal,context){
  const opts=settings(config),action=proposal.action??null,ordinary=proposal.ordinary===true;
  assertRule(string(proposal.body)&&["enter","exit",null].includes(action),"note body and valid action required");
  const source=sourceOf(context,proposal.messageIds??[]),fingerprint=commandFingerprint(proposal,source);
  const existing=state.notes.find(n=>n.id===context.requestId);
  if(existing){assertRule(existing.fingerprint===fingerprint,"request id reused with different payload");return {state,note:existing,replayed:true,settled:{ordinary:existing.ordinary,rest:existing.action}}}
  assertRule(context.expectedRevision===state.revision,"stale revision");
  assertRule(ordinary||action!==null,"no writing task");
  assertRule(!ordinary||opts.ordinaryEnabled,"ordinary excerpts disabled");
  assertRule(!action||opts.restEnabled,"rest box disabled");
  if(ordinary)assertRule(eligible(context.counts?.ordinary??0,opts.ordinary).allowed,"ordinary minimum not reached");
  if(action)assertRule((action==="exit"&&context.exitMethod==="recall")||eligible(context.counts?.[action]??0,opts[action]).allowed,"rest minimum not reached");
  let cycles=state.cycles,cycleId=state.activeCycleId,linked=null;const current=activeCycle(state);
  if(action==="enter"){
    assertRule(!cycleId,"cycle already active");assertRule(string(proposal.reason),"entry reason required");assertRule(id(context.cycleId)&&!cycles.some(c=>c.id===context.cycleId),"invalid new cycle");
    const tags=tagsOf(proposal.tags);linked=context.cycleId;cycleId=linked;
    cycles=[...cycles,{id:linked,entry:{noteId:context.requestId,source,tags,reason:proposal.reason},currentTags:tags,exit:null,events:[]}];
  }else if(action==="exit"){
    assertRule(current&&!current.exit&&context.cycleId===current.id&&context.at>=current.entry.source.at,"no matching active cycle");assertRule(["recall","self"].includes(context.exitMethod),"invalid trusted exit method");
    const tags=tagsOf(proposal.tags);linked=current.id;cycleId=null;
    cycles=cycles.map(c=>c.id===linked?{...c,currentTags:tags,exit:{noteId:context.requestId,source,tags,method:context.exitMethod,elapsedMs:context.at-c.entry.source.at}}:c);
  }
  const note={id:context.requestId,body:proposal.body,ordinary,action,cycleId:linked,source,fingerprint};
  return {state:{...state,revision:state.revision+1,activeCycleId:cycleId,notes:[...state.notes,note],cycles},note,replayed:false,settled:{ordinary,rest:action}};
}

function appendRestEvent(state,event,context){
  assertRule(id(context.requestId)&&id(context.cycleId)&&id(context.windowId)&&time(context.at),"invalid event context");
  assertRule(["interaction","dialogue","action","state"].includes(event.kind)&&id(event.refId),"invalid actual event reference");
  const old=state.cycles.flatMap(c=>c.events).find(e=>e.id===context.requestId);
  if(old){assertRule(old.cycleId===context.cycleId&&old.kind===event.kind&&old.refId===event.refId&&old.windowId===context.windowId,"event id reused");return state}
  assertRule(context.expectedRevision===state.revision,"stale revision");
  const c=activeCycle(state);assertRule(c&&c.id===context.cycleId&&context.at>=c.entry.source.at,"closed or missing cycle");
  const tags=event.kind==="state"?tagsOf(event.tags):null;
  const record={id:context.requestId,cycleId:c.id,kind:event.kind,refId:event.refId,windowId:context.windowId,at:context.at,...(tags?{tags}:{})};
  return {...state,revision:state.revision+1,cycles:state.cycles.map(x=>x.id===c.id?{...x,currentTags:tags??x.currentTags,events:[...x.events,record]}:x)};
}

function readNotes(state,config,query={},visibleWindowIds=[]){
  const opts=settings(config),visible=new Set(visibleWindowIds),type=query.type??"all",limit=query.limit??opts.readLimit;
  assertRule(["all","ordinary","rest","enter","exit"].includes(type)&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,"invalid query");
  assertRule((query.from==null||time(query.from))&&(query.to==null||time(query.to))&&(query.from==null||query.to==null||query.from<=query.to),"invalid time filter");
  if(query.before)assertRule(time(query.before.at)&&id(query.before.id),"invalid cursor");
  const keyword=typeof query.keyword==="string"?query.keyword.trim().toLocaleLowerCase():"";
  const rows=state.notes.filter(n=>visible.has(n.source.windowId)&&(type==="all"||(type==="ordinary"?n.ordinary:type==="rest"?!!n.action:n.action===type))&&(!query.windowId||n.source.windowId===query.windowId)&&(query.from==null||n.source.at>=query.from)&&(query.to==null||n.source.at<=query.to)&&(!keyword||n.body.toLocaleLowerCase().includes(keyword))&&(!query.before||n.source.at<query.before.at||n.source.at===query.before.at&&n.id<query.before.id)).sort((a,b)=>b.source.at-a.source.at||(a.id===b.id?0:a.id>b.id?-1:1));
  const items=rows.slice(0,limit).map(({fingerprint,...n})=>n),last=items.at(-1);
  return {items,next:rows.length>limit?{at:last.source.at,id:last.id}:null};
}
export {settings,eligible,initialNotes,writeNote,appendRestEvent,readNotes};
