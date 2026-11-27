// Autonomous activity borrows ordinary model permissions, never a fictional
// chat turn or the official MCP role. These are explicit, opt-in tool groups.
// Tools requiring a live user turn, media target or destructive action stay out.
export const DREAM_TOOL_GROUPS=Object.freeze({
  allowWeb:['independent_web_search','independent_web_read'],
  allowLibrary:['library_books','library_read','library_notes'],
  allowMemory:['memory_search'],
  allowCalendar:['calendar_list'],
  allowCollection:['vault_search_index','vault_read_selected'],
  allowLibraryWrite:['library_write'],
  allowDailyWrite:['create_moment','create_diary'],
  allowCalendarWrite:['calendar_create'],
  allowVoice:['voice_create'],
  allowImage:['image_generate'],
  allowMemoryCandidate:['dream_memory_candidate'],
});
export const DREAM_CONTEXT_FLAGS=Object.freeze(['includeCustom','includeUserPortrait','includeSelfPortrait','includeConversationCount','includeWeather','includeCalendar','includeSteps','includeAppUsage','allowImageReadback']);
export const DREAM_TOOL_FLAGS=Object.freeze(Object.keys(DREAM_TOOL_GROUPS));
export function dreamToolAllowed(config,name){
  const e=config?.execution||{};
  if(name==='dream_read_history')return e.readHistory===true;
  if(name==='dream_write_note')return e.writeNote===true;
  if(name==='dream_schedule_extra')return config.allowExtra===true&&e.extraPerDay>0;
  if(name==='voice_create'&&(e.voiceLimit??1)===0||name==='image_generate'&&(e.imageLimit??1)===0)return false;
  return Object.entries(DREAM_TOOL_GROUPS).some(([flag,names])=>e[flag]===true&&names.includes(name));
}
export function dreamToolNames(config){
  return Object.values(DREAM_TOOL_GROUPS).flat().filter(name=>dreamToolAllowed(config,name));
}
