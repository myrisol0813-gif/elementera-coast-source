// Pure eligibility policy. No timers, provider calls or restored jobs are started here.
// The executor must revalidate permissions, model, budgets and acquire a durable claim.
export function localClock(at, zone) {
  if (!Number.isSafeInteger(at)) throw new TypeError('invalid epoch milliseconds');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(new Date(at));
  const p=Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return { day:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute) };
}
function minuteOfDay(value) {
  if(typeof value!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value))throw new TypeError('invalid local time');
  const [h,m]=value.split(':').map(Number);
  return h*60+m;
}
function inQuietTime(minute, quiet) {
  if(!quiet)return false;
  const start=minuteOfDay(quiet.start),end=minuteOfDay(quiet.end);
  if(start===end)return true; // equal bounds are all-day quiet, never silently open
  return start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
// Config must be explicitly enabled and armed by the owner on the current device.
// Missing authorization (including on restored archives) fails closed.
// Daily keys use local calendar date, not a rolling 24h interval: DST cannot duplicate a day.
// A missed day is never replayed. Enabling after today's scheduled time starts tomorrow.
export function dreamTideCandidate(config, state, now) {
  if(config?.enabled!==true||state?.armed!==true)return null;
  if(typeof config.timeZone!=='string'||!config.timeZone||!Number.isSafeInteger(state.armedAt)||state.armedAt>now)return null;
  const here=localClock(now,config.timeZone),armed=localClock(state.armedAt,config.timeZone);
  const daily=minuteOfDay(config.dailyTime);
  if(inQuietTime(here.minute,config.quietHours)||state.busy===true)return null;
  if(here.minute>=daily && !(armed.day===here.day&&armed.minute>daily) && state.lastDailyDay!==here.day) {
    return {kind:'daily',key:'daily:'+here.day+(config.scheduleEpoch?':'+config.scheduleEpoch:''),day:here.day};
  }
  // An extra wake is optional, one-shot and scoped to the same local day.
  // The future executor must authorize its creation; this function never creates it.
  const extra=state.extra;
  if(extra&&typeof extra.id==='string'&&extra.id&&Number.isSafeInteger(extra.at)&&extra.at>=state.armedAt&&extra.at<=now&&localClock(extra.at,config.timeZone).day===here.day&&state.lastExtraId!==extra.id){
    return {kind:'extra',key:'extra:'+extra.id,day:here.day};
  }
  return null;
}
