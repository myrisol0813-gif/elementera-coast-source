// Independent interaction transaction proposals; trusted adapter must prove live gesture/model receipt, authorization, scope and durable CAS. No automatic animation emits an event.
function requireRule(ok,msg){if(!ok)throw Error(msg)}

function validId(s){return typeof s==="string"&&s.length>0&&s.length<=200&&!/[\x00-\x1f]/.test(s)&&!["__proto__","constructor","prototype"].includes(s)}

function point(p){requireRule(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1,"invalid normalized position");return {x:p.x,y:p.y}}

function initialInteraction(){return {version:1,revision:0,events:[],claims:[],positions:{model:{x:.65,y:.73},human:{x:.25,y:.73}}}}

function contactEvidence(start,end,target,radius){const a=point(start),b=point(end),c=point(target);requireRule(Number.isFinite(radius)&&radius>0&&radius<=.2,"invalid contact radius");const distance=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);return distance(a,b)>=.015&&distance(b,c)<=radius&&distance(a,c)>radius}

function emojiList(values){requireRule(Array.isArray(values)&&values.length>=1&&values.length<=3,"one to three emoji");const segmenter=new Intl.Segmenter(undefined,{granularity:"grapheme"});for(const v of values){requireRule(typeof v==="string"&&v.length<=40&&[...segmenter.segment(v)].length===1&&(/^\p{Regional_Indicator}{2}$/u.test(v)||/^[#*0-9]\uFE0F?\u20E3$/u.test(v)||(/^\p{Extended_Pictographic}/u.test(v)&&/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\u{E0020}-\u{E007F}]+$/u.test(v))),"invalid emoji")}return [...values]}

function applyInteraction(state,proposal,context){
  requireRule(validId(context.eventId)&&validId(context.windowId)&&Number.isSafeInteger(context.at)&&context.at>=0,"invalid trusted context");
  requireRule(["human","model"].includes(context.actor)&&["gesture","model-tool","human-control"].includes(context.origin),"invalid origin");
  requireRule(context.origin==="model-tool"?context.actor==="model"&&validId(context.turnId):context.actor==="human","actor/origin mismatch");
  requireRule(context.live===true&&context.editing!==true&&context.preview!==true,"not a live interaction");
  requireRule(context.scope==="desktop"||context.scope==="rest","invalid scope");
  if(context.scope==="rest")requireRule(validId(context.cycleId),"rest cycle required");
  const base={id:context.eventId,actor:context.actor,origin:context.origin,windowId:context.windowId,turnId:context.turnId??null,scope:context.scope,cycleId:context.scope==="rest"?context.cycleId:null,at:context.at};
  const prior=state.events.find(e=>e.id===base.id);
  if(prior&&proposal.kind==="move"){
    requireRule(prior.actor===base.actor&&prior.origin===base.origin&&prior.windowId===base.windowId&&prior.scope===base.scope&&prior.cycleId===base.cycleId&&["move","contact"].includes(prior.data.kind)&&JSON.stringify(prior.data.start)===JSON.stringify(point(proposal.start))&&JSON.stringify(prior.data.end)===JSON.stringify(point(proposal.end)),"event id reused");
    return {state,event:prior,replayed:true};
  }
  let data,positions=state.positions;
  switch(proposal.kind){
    case "move":{
      requireRule(context.actor==="human"&&context.origin==="gesture"&&context.humanEnabled===true,"only human drag");
      const end=point(proposal.end),start=point(proposal.start);
      requireRule(Math.hypot(start.x-state.positions.human.x,start.y-state.positions.human.y)<.001,"stale drag start");
      const touched=contactEvidence(start,end,state.positions.model,context.contactRadius);
      positions={...state.positions,human:end};
      data={kind:touched?"contact":"move",start,end,...(touched?{target:"model"}:{})};break;
    }
    case "emoji":requireRule(context.actor==="model"||context.humanEnabled===true,"human avatar disabled");data={kind:"emoji",values:emojiList(proposal.values)};break;
    case "action":requireRule(context.actor==="model"||context.humanEnabled===true,"human avatar disabled");requireRule(["idle","cling","cheer","sad","sit","sleep","approach","greet","follow","side-by-side"].includes(proposal.action),"invalid action");data={kind:"action",action:proposal.action};break;
    case "gift":requireRule(context.actor==="model"||context.humanEnabled===true,"human avatar disabled");requireRule(context.propSupported===true&&["book","flower","cookie","tea","letter"].includes(proposal.prop),"unsupported prop");data={kind:"gift",prop:proposal.prop};break;
    default:throw Error("unknown interaction");
  }
  const old=state.events.find(e=>e.id===base.id);
  if(old){requireRule(old.actor===base.actor&&old.windowId===base.windowId&&old.scope===base.scope&&old.cycleId===base.cycleId&&old.turnId===base.turnId&&JSON.stringify(old.data)===JSON.stringify(data),"event id reused");return {state,event:old,replayed:true}}
  requireRule(context.expectedRevision===state.revision,"stale interaction revision");
  const event={...base,data};
  return {state:{...state,revision:state.revision+1,positions,events:[...state.events,event]},event,replayed:false}
}

function pendingContacts(state,scope,cycleId,visibleWindowIds,limit=20){
  requireRule(Number.isInteger(limit)&&limit>0&&limit<=100,"invalid limit");
  const allowed=new Set(visibleWindowIds),claimed=new Set(state.claims.flatMap(c=>c.eventIds));
  return state.events.filter(e=>e.actor==="human"&&e.data.kind==="contact"&&e.scope===scope&&e.cycleId===(scope==="rest"?cycleId:null)&&allowed.has(e.windowId)&&!claimed.has(e.id)).slice(0,limit)
}

function claimContacts(state,context,eventIds){
  requireRule(validId(context.callId)&&validId(context.windowId)&&Array.isArray(eventIds)&&new Set(eventIds).size===eventIds.length&&eventIds.length<=100,"invalid receipt");
  const old=state.claims.find(c=>c.callId===context.callId);
  if(old){requireRule(old.windowId===context.windowId&&JSON.stringify(old.eventIds)===JSON.stringify(eventIds),"receipt mismatch");return state}
  requireRule(context.expectedRevision===state.revision&&context.responseCommitted===true,"receipt not committed");
  const pending=new Set(pendingContacts(state,context.scope,context.cycleId,context.visibleWindowIds,100).map(e=>e.id));
  requireRule(eventIds.every(id=>pending.has(id)),"event not pending or inaccessible");
  if(!eventIds.length)return state;
  return {...state,revision:state.revision+1,claims:[...state.claims,{callId:context.callId,windowId:context.windowId,eventIds:[...eventIds]}]}
}
export {initialInteraction,contactEvidence,emojiList,applyInteraction,pendingContacts,claimContacts};
