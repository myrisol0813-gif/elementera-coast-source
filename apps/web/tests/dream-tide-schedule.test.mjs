import test from 'node:test';
import assert from 'node:assert/strict';
import {dreamTideCandidate as candidate} from '../functions/dream-tide-schedule.js';
const t=Date.parse;
const config={enabled:true,timeZone:'Asia/Shanghai',dailyTime:'09:00'};
const armed={armed:true,armedAt:t('2026-11-26T00:00:00Z')};
test('explicit arming and local calendar date, no replay of previous days',()=>{
  assert.equal(candidate(config,{...armed,armed:false},t('2026-11-27T02:00:00Z')),null);
  assert.equal(candidate({...config,enabled:false},armed,t('2026-11-27T02:00:00Z')),null);
  assert.equal(candidate(config,armed,t('2026-11-27T00:59:00Z')),null);
  assert.deepEqual(candidate(config,armed,t('2026-11-27T01:00:00Z')),{kind:'daily',key:'daily:2026-11-27',day:'2026-11-27'});
  assert.equal(candidate(config,{...armed,lastDailyDay:'2026-11-27'},t('2026-11-27T06:00:00Z')),null);
  assert.equal(candidate(config,{...armed,armedAt:t('2026-11-27T02:00:00Z')},t('2026-11-27T03:00:00Z')),null);
  assert.equal(candidate(config,armed,t('2026-11-29T06:00:00Z')).day,'2026-11-29');
});
test('busy and quiet times defer without starting a job',()=>{
  const now=t('2026-11-27T02:00:00Z');
  assert.equal(candidate(config,{...armed,busy:true},now),null);
  assert.equal(candidate({...config,quietHours:{start:'23:00',end:'11:00'}},armed,now),null);
  assert.equal(candidate({...config,quietHours:{start:'00:00',end:'00:00'}},armed,now),null);
  assert.equal(candidate({...config,quietHours:{start:'23:00',end:'11:00'}},armed,t('2026-11-27T03:00:00Z')).kind,'daily');
});
test('optional extra is a same-day one-shot; daily has priority',()=>{
  const now=t('2026-11-27T03:00:00Z'),extra={id:'fixture',at:t('2026-11-27T02:00:00Z')};
  assert.equal(candidate(config,{...armed,extra},now).kind,'daily');
  const s={...armed,extra,lastDailyDay:'2026-11-27'};
  assert.equal(candidate(config,s,now).key,'extra:fixture');
  assert.equal(candidate(config,{...s,lastExtraId:'fixture'},now),null);
  assert.equal(candidate(config,{...s,lastDailyDay:'2026-11-28'},t('2026-11-28T03:00:00Z')),null);
});
test('DST repeated hour retains same slot; invalid clocks fail closed at caller',()=>{
  const cfg={enabled:true,timeZone:'America/New_York',dailyTime:'01:30'};
  const first=candidate(cfg,armed,t('2026-11-01T05:30:00Z'));
  const old={armed:true,armedAt:t('2026-10-31T00:00:00Z')};
  assert.equal(first,null);
  assert.equal(candidate(cfg,old,t('2026-11-01T05:30:00Z')).key,'daily:2026-11-01');
  assert.equal(candidate(cfg,{...old,lastDailyDay:'2026-11-01'},t('2026-11-01T06:30:00Z')),null);
  assert.throws(()=>candidate({...cfg,dailyTime:'25:00'},old,t('2026-11-01T05:30:00Z')),TypeError);
});
