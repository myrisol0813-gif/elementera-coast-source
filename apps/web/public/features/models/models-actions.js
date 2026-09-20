import { HANDLER_NAMES } from './models-constants.js';
export function createModelsActions({chat,router,toast,getSearchDraft,setSearch,fetchCatalog,quickPicker}){
  async function changeBox(modelId,groupName,add){
    const profile=chat.getProfile();const box={chat:[...(profile.model_box?.chat||[])],free:[...(profile.model_box?.free||[])],image:[...(profile.model_box?.image||[])]};const group=['chat','free','image'].includes(groupName)?groupName:'chat';
    box[group]=add?[...new Set([...box[group],modelId])]:box[group].filter((id)=>id!==modelId);
    const patch={model_box:box};if(!add&&profile.current_chat_model===modelId)patch.current_chat_model=box.chat[0]||box.free[0]||'';if(!add&&profile.current_image_model===modelId)patch.current_image_model=box.image[0]||'';
    await chat.updateProfile(patch);toast(add?'模型已添加':'模型已移除',2000);await router.refresh();
  }
  async function selectChat(modelId,{closePicker=false}={}){await chat.updateProfile({current_chat_model:modelId});quickPicker.updateTopLabel();quickPicker.renderQuickPicker();toast('模型已切换',2000);if(closePicker)quickPicker.closeQuickPicker();}
  async function handleAction(name,target){
    if(name==='quick')return quickPicker.toggleQuickPicker();
    if(name==='open'){quickPicker.closeQuickPicker();return router.open('models');}
    if(name==='quick-select')return selectChat(target.dataset.id,{closePicker:true});
    if(name==='refresh'){try{await fetchCatalog(true);toast('模型目录已刷新');await router.refresh();}catch(error){toast(`刷新失败：${error.message}`);}return;}
    if(name==='add')return changeBox(target.dataset.id,target.dataset.group,true);
    if(name==='remove')return changeBox(target.dataset.id,target.dataset.group,false);
    if(name==='select-chat'){await selectChat(target.dataset.id);return router.refresh();}
    if(name==='select-image'){await chat.updateProfile({current_image_model:target.dataset.id});toast('图片模型已切换',2000);return router.refresh();}
  }
  async function handleSubmit(name){if(name!=='search')return;setSearch(getSearchDraft().trim());await router.refresh({preserveScroll:false});}
  function handlerFor(context,handlers){const handlerName=HANDLER_NAMES[context.eventType];return handlerName?{handlerName,handler:handlers[handlerName]}:null;}
  function ownsEvent(_event,context,handlers){const entry=handlerFor(context,handlers);if(context.namespace!=='models'||typeof entry?.handler!=='function')return false;return {preventDefault:context.eventType==='click'||context.eventType==='submit'};}
  function handleEvent(event,context,handlers){const entry=handlerFor(context,handlers);return entry?.handler?.(context.name,context.target,event);}
  return Object.freeze({changeBox,selectChat,handleAction,handleSubmit,ownsEvent,handleEvent});
}
