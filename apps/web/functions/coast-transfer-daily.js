import { ensureDailySchema } from './daily-schema.js';
import { TransferError } from './coast-transfer.js';

// Portable daily rows include their individual likes and provenance. Never
// reconstruct historical actors or timestamps from a legacy aggregate count.
const privateApp='com.elementeracoast.app', publicApp='com.elementeracoast.source';
const idOK=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const require=(ok,message)=>{if(!ok)throw new TransferError('invalid_daily_transfer',message);};
const time=v=>{const t=typeof v==='number'?v:Date.parse(v);require(Number.isSafeInteger(t)&&t>=0,'日常记录时间无效。');return t;};
const iso=v=>new Date(time(v)).toISOString();
const optionalTime=v=>v==null?null:iso(v);
const text=(v,max,required=false)=>{require(typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0),'日常文字无效或超限。');return v;};
const optionalText=(v,max)=>v==null?null:text(v,max);
const optionalId=v=>{require(v==null||idOK(v),'日常来源 ID 无效。');return v??null;};
const day=v=>{require(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'日常日期无效。');return v;};
const keys=(v,allowed)=>require(obj(v)&&Object.keys(v).every(k=>allowed.includes(k)),'日常记录含未知字段，未丢弃。');
function stable(v){if(Array.isArray(v))return v.map(stable);if(obj(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const all=async(db,sql)=>(await db.prepare(sql).all()).results||[];
const config=app=>app===publicApp?{owner:'owner',partner:'model_partner',avatar:'owner_avatar_dataurl',partnerAvatar:'model_partner_avatar_dataurl',name:'model_partner_display_name',ownerName:'屋主',apiName:'前端 API ✦'}:{owner:'xiaohan',partner:'myri',avatar:'xiaohan_avatar_dataurl',partnerAvatar:'myri_avatar_dataurl',name:'myri_display_name',ownerName:'小寒',apiName:'海岸 API ✦'};
function author(v,c){if(['owner','xiaohan'].includes(v))return c.owner;if(['model_partner','myri'].includes(v))return c.partner;require(['api','mcp'].includes(v),'日常作者或点赞者无效。');return v;}
function json(raw,fallback){if(raw==null||raw==='')return fallback;try{return JSON.parse(raw);}catch{throw new TransferError('invalid_daily_transfer','日常原始 JSON 已损坏，未生成不完整记录。');}}
function usage(v){
  if(v==null)return null;
  const allowed=['prompt_tokens','completion_tokens','reasoning_tokens','cached_tokens','total_tokens'];keys(v,allowed);
  const out={};for(const k of allowed){if(v[k]==null)continue;require(Number.isSafeInteger(v[k])&&v[k]>=0,'日常评论用量无效。');out[k]=v[k];}
  return Object.keys(out).length?out:null;
}
function identity(row,c){
  const a=author(row.author,c);
  const surface=text(row.surface|| (a==='mcp'?'official_mcp':[c.partner,'api'].includes(a)?'coast_api':'web_manual'),180);
  return {author:a,actor:row.actor==null?null:author(row.actor,c),surface,model_label:optionalText(row.model_label,180),model_nickname:optionalText(row.model_nickname,180),
    symbol:text(row.symbol??(surface==='official_mcp'?'≋':surface==='coast_api'?'✦':''),80),
    display_author:text(row.display_author||(surface==='official_mcp'?'ChatGPT≋':surface==='coast_api'?c.apiName:c.ownerName),180)};
}
const commonKeys=['id','date','author','source','text','conversation_id','source_turn_id','tool_call_id','actor','surface','model_label','model_nickname','symbol','display_author','created_at','updated_at'];
function common(row,c,max){
  require(idOK(row.id),'日常记录 ID 无效。');
  require(['manual','chat_tool'].includes(row.source),'日常来源无效。');
  return {id:row.id,date:day(row.date),source:row.source,text:text(row.text,max,true),conversation_id:optionalId(row.conversation_id),source_turn_id:optionalId(row.source_turn_id),tool_call_id:optionalId(row.tool_call_id),...identity(row,c),created_at:iso(row.created_at),updated_at:iso(row.updated_at)};
}
function comment(row,c){
  keys(row,['id','author','text','model_id','usage','created_at']);
  require(idOK(row.id),'评论 ID 无效。');
  return {id:row.id,author:author(row.author,c),text:text(row.text,2000,true),model_id:optionalText(row.model_id,180),usage:usage(row.usage),created_at:iso(row.created_at)};
}
function moment(row,c){
  keys(row,[...commonKeys,'status','reason','published_at','liked','like_count','comments','likes']);
  require(row.status==='published'&&Array.isArray(row.comments),'动态状态或评论列表无效。');
  require(typeof row.liked==='boolean'&&Number.isSafeInteger(row.like_count)&&row.like_count>=0,'点赞统计无效。');
  const rawLikes=row.likes==null&&row.like_count===0&&!row.liked?[]:row.likes;
  require(Array.isArray(rawLikes),'旧本机只有点赞数量，缺少真实点赞者或时间；此条动态暂不能无损写入云端。');
  const likes=rawLikes.map(v=>{keys(v,['actor','created_at']);return {actor:author(v.actor,c),created_at:iso(v.created_at)};}).sort((a,b)=>a.actor.localeCompare(b.actor));
  require(new Set(likes.map(v=>v.actor)).size===likes.length&&row.like_count===likes.length&&row.liked===likes.some(v=>v.actor===c.owner),'点赞明细与数量不一致。');
  const comments=row.comments.map(v=>comment(v,c));
  require(new Set(comments.map(v=>v.id)).size===comments.length,'动态内评论 ID 重复。');
  comments.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
  return {...common(row,c,12000),status:row.status,reason:optionalText(row.reason,1000),published_at:optionalTime(row.published_at),liked:row.liked,like_count:likes.length,comments,likes};
}
function diary(row,c){
  keys(row,[...commonKeys,'weather','mood','tags']);
  require(Array.isArray(row.tags)&&row.tags.length<=20&&new Set(row.tags).size===row.tags.length,'日记标签无效。');
  return {...common(row,c,24000),weather:text(row.weather,80),mood:text(row.mood,120),tags:row.tags.map(v=>text(v,80,true))};
}
function profile(row,origin,c){
  if(row==null)return null;
  const o=config(origin);keys(row,[o.avatar,o.partnerAvatar,'moment_cover_dataurl',o.name,'updated_at']);
  const image=(v,max)=>{text(v,max);require(!v||/^data:image\/(png|jpe?g|webp);base64,/i.test(v),'日常头像或封面格式无效。');return v;};
  const name=text(row[o.name],80,true);require(name.trim()===name&&!/[\r\n\t]/.test(name),'日常显示名称无效。');
  require(row.updated_at!=null,'日常资料缺少更新时间，未伪造历史时间。');
  return {[c.avatar]:image(row[o.avatar],360000),[c.partnerAvatar]:image(row[o.partnerAvatar],360000),moment_cover_dataurl:image(row.moment_cover_dataurl,1200000),[c.name]:name,updated_at:iso(row.updated_at)};
}
function fromDB(row,c){
  return {id:row.id,date:row.date,author:row.author,source:row.source,text:row.text,conversation_id:row.conversation_id,source_turn_id:row.source_turn_id,tool_call_id:row.tool_call_id,actor:row.actor,
    surface:row.surface,model_label:row.model_label,model_nickname:row.model_nickname,symbol:row.symbol,display_author:row.display_author,created_at:iso(row.created_at),updated_at:iso(row.updated_at)};
}
export async function exportDailyTransfer(db,app){
  await ensureDailySchema(db);const c=config(app);
  const [moments,diaries,comments,likes,profiles]=await Promise.all([
    all(db,'SELECT * FROM daily_moments ORDER BY created_at DESC,id'),
    all(db,'SELECT * FROM daily_diaries ORDER BY date DESC,created_at DESC,id'),
    all(db,'SELECT * FROM daily_moment_comments ORDER BY created_at,id'),
    all(db,'SELECT * FROM daily_moment_likes ORDER BY actor'),
    all(db,"SELECT * FROM daily_profile WHERE id = 'owner'")]);
  const commentMap=new Map(),likeMap=new Map();
  for(const row of comments){const list=commentMap.get(row.moment_id)||[];list.push({id:row.id,author:row.author,text:row.text,model_id:row.model_id,usage:json(row.usage_json,null),created_at:iso(row.created_at)});commentMap.set(row.moment_id,list);}
  for(const row of likes){const list=likeMap.get(row.moment_id)||[];list.push({actor:row.actor,created_at:iso(row.created_at)});likeMap.set(row.moment_id,list);}
  const ids=new Set(moments.map(v=>v.id));require([...commentMap.keys(),...likeMap.keys()].every(v=>ids.has(v)),'日常数据库存在孤立评论或点赞，未导出不完整资料。');
  const p=profiles[0];
  return {moments:moments.map(row=>{
    const list=likeMap.get(row.id)||[];
    return moment({...fromDB(row,c),status:row.status,reason:row.reason,published_at:optionalTime(row.published_at),comments:commentMap.get(row.id)||[],likes:list,like_count:list.length,liked:list.some(v=>v.actor===c.owner)},c);
  }),diaries:diaries.map(row=>diary({...fromDB(row,c),weather:row.weather||'未标注',mood:row.mood||'未标注',tags:json(row.tags_json,[])},c)),
  dailyProfile:p?profile({[c.avatar]:p[c.avatar],[c.partnerAvatar]:p[c.partnerAvatar],moment_cover_dataurl:p.moment_cover_dataurl,[c.name]:p[c.name],updated_at:iso(p.updated_at)},app,c):null};
}
const commonColumns=['id','date','author','source','text','conversation_id','source_turn_id','tool_call_id','actor','surface','model_label','model_nickname','symbol','display_author','created_at','updated_at'];
function insert(db,table,cols,values){return db.prepare('INSERT INTO '+table+' ('+cols.join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')').bind(...values);}
function commonValues(row){return commonColumns.map(k=>k==='created_at'||k==='updated_at'?time(row[k]):row[k]);}
export async function prepareDailyTransfer(db,payload,app){
  require([privateApp,publicApp].includes(payload.applicationId),'未知版本的日常身份结构，未写入。');
  const c=config(app), current=await exportDailyTransfer(db,app);
  const report={ready:0,existing:0,conflicts:0,blocked:[]}, statements=[];
  const existingMoments=new Map(current.moments.map(v=>[v.id,v])), existingDiaries=new Map(current.diaries.map(v=>[v.id,v]));
  const commentIds=new Set(current.moments.flatMap(v=>v.comments.map(x=>x.id)));
  const momentTools=new Set(current.moments.map(v=>v.tool_call_id).filter(Boolean)), diaryTools=new Set(current.diaries.map(v=>v.tool_call_id).filter(Boolean));
  function process(rows,existing,validate,prepare){
    const seen=new Set();
    for(const raw of rows){
      require(idOK(raw?.id)&&!seen.has(raw.id),'日常数据包内 ID 重复或无效。');seen.add(raw.id);
      try{
        const row=validate(raw,c);
        if(existing.has(row.id)){report.existing++;if(!equal(existing.get(row.id),row))report.conflicts++;continue;}
        const next=prepare(row);statements.push(...next);report.ready++;
      }catch(e){if(!(e instanceof TransferError))throw e;report.blocked.push({id:raw.id,reason:e.message});}
    }
  }
  process(payload.moments,existingMoments,moment,row=>{
    require(!row.tool_call_id||!momentTools.has(row.tool_call_id),'动态工具调用 ID 冲突。');
    require(row.comments.every(v=>!commentIds.has(v.id)),'评论 ID 与目标现有记录冲突。');
    if(row.tool_call_id)momentTools.add(row.tool_call_id);row.comments.forEach(v=>commentIds.add(v.id));
    return [insert(db,'daily_moments',[...commonColumns,'status','reason','published_at'],[...commonValues(row),row.status,row.reason,row.published_at==null?null:time(row.published_at)]),
      ...row.comments.map(v=>insert(db,'daily_moment_comments',['id','moment_id','author','text','model_id','usage_json','created_at'],[v.id,row.id,v.author,v.text,v.model_id,v.usage?JSON.stringify(v.usage):null,time(v.created_at)])),
      ...row.likes.map(v=>insert(db,'daily_moment_likes',['moment_id','actor','created_at'],[row.id,v.actor,time(v.created_at)]))];
  });
  process(payload.diaries,existingDiaries,diary,row=>{
    require(!row.tool_call_id||!diaryTools.has(row.tool_call_id),'日记工具调用 ID 冲突。');
    if(row.tool_call_id)diaryTools.add(row.tool_call_id);
    return [insert(db,'daily_diaries',[...commonColumns,'weather','mood','tags_json'],[...commonValues(row),row.weather,row.mood,JSON.stringify(row.tags)])];
  });
  if(payload.dailyProfile!==null){
    try{
      const p=profile(payload.dailyProfile,payload.applicationId,c);
      if(current.dailyProfile){report.existing++;if(!equal(current.dailyProfile,p))report.conflicts++;}
      else{statements.push(insert(db,'daily_profile',['id',c.avatar,c.partnerAvatar,'moment_cover_dataurl',c.name,'updated_at'],['owner',p[c.avatar],p[c.partnerAvatar],p.moment_cover_dataurl,p[c.name],time(p.updated_at)]));report.ready++;}
    }catch(e){if(!(e instanceof TransferError))throw e;report.blocked.push({id:'daily_profile',reason:e.message});}
  }
  return {report,statements};
}
