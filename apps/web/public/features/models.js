import { DEFAULT_FREE } from './models/models-constants.js';
import { fetchModelsCatalog } from './models/models-client.js';
import { modelById, modelName } from './models/models-format.js';
import { createModelsView } from './models/models-view.js';
import { createModelsQuickPicker } from './models/models-quick-picker.js';
import { createModelsActions } from './models/models-actions.js';

export function createModels({chat,router,toast}){
  let catalog=null,search='',searchDraft='',unsubscribeProfile=null;
  const getCatalog=()=>catalog,getSearch=()=>search,getSearchDraft=()=>searchDraft,setSearch=(value)=>{search=value;};
  async function ensureSelections(){
    if(!catalog)return;const profile=chat.getProfile();const box=profile.model_box||{chat:[],free:[],image:[]};
    const next={chat:[...new Set([...(box.chat||[]),catalog.defaults?.chat].filter(Boolean))],free:[...new Set([...(box.free||[]),...DEFAULT_FREE].filter(Boolean))],image:[...new Set([...(box.image||[]),catalog.defaults?.image].filter(Boolean))]};
    const currentChat=profile.current_chat_model||next.chat[0]||next.free[0]||'';const currentImage=profile.current_image_model||next.image[0]||'';
    if(JSON.stringify(box)!==JSON.stringify(next)||currentChat!==profile.current_chat_model||currentImage!==profile.current_image_model)await chat.updateProfile({model_box:next,current_chat_model:currentChat,current_image_model:currentImage});
  }
  let quickPicker=null;
  async function fetchCatalog(force=false){catalog=await fetchModelsCatalog(force);await ensureSelections();quickPicker?.updateTopLabel();quickPicker?.renderQuickPicker();return catalog;}
  quickPicker=createModelsQuickPicker({chat,toast,getCatalog,fetchCatalog});
  const view=createModelsView({chat,getCatalog,getSearch,getSearchDraft});
  const actions=createModelsActions({chat,router,toast,getSearchDraft,setSearch,fetchCatalog,quickPicker});
  function handleInput(name,target){if(name==='search-draft')searchDraft=target.value;}
  const handlers={handleAction:actions.handleAction,handleSubmit:actions.handleSubmit,handleInput};
  router.register('models',async()=>{quickPicker.closeQuickPicker();if(!catalog){try{await fetchCatalog();}catch(error){toast(`模型目录读取失败：${error.message}`);}}return view.view();});
  function mount(){if(!unsubscribeProfile)unsubscribeProfile=chat.onProfile((profile)=>{quickPicker.updateTopLabel(profile);quickPicker.renderQuickPicker(profile);});quickPicker.updateTopLabel();quickPicker.renderQuickPicker();}
  function refresh(context={}){quickPicker.updateTopLabel();quickPicker.renderQuickPicker();if(context.navigation&&context.navigation.current?.name!=='models')quickPicker.closeQuickPicker();}
  function destroy(){unsubscribeProfile?.();unsubscribeProfile=null;quickPicker.closeQuickPicker();}
  return Object.freeze({id:'models',priority:80,mountOrder:80,observeEvent:quickPicker.observeEvent,ownsRoute:(route)=>route?.name==='models',ownsEvent:(event,context)=>actions.ownsEvent(event,context,handlers),handleEvent:(event,context)=>actions.handleEvent(event,context,handlers),mount,refresh,destroy,handleAction:actions.handleAction,handleInput,handleSubmit:actions.handleSubmit,closeQuickPicker:quickPicker.closeQuickPicker,fetchCatalog,modelName:(id)=>modelName(catalog,id),modelById:(id)=>modelById(catalog,id),getCatalog});
}
