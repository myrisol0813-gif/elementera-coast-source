import {editAppearance,poseColors,ACTIONS,GLASSES,NECK} from './creature-state.mjs';
import {createCreatureRenderer} from './creature-renderer.mjs';
const actions={idle:'醒着',cling:'撒娇',cheer:'开心',sad:'委屈',sit:'坐坐',sleep:'睡觉'};
const glasses={none:'无',round:'圆框',square:'方框',sun:'墨镜',mono:'单片'};
const neck={none:'无',tie:'领带',bow:'领结',scarf:'围巾'};
const names={default:'原色',gold:'金色',collie:'边牧',tan:'铁包金',shepherd:'德牧',snow:'冬雪',summer:'夏毛',moon:'月雾',tern:'燕鸥',chick:'小黄鸡',blue:'雾蓝',black:'黑金',red:'红栗',cream:'奶茶',berry:'莓果'};
const slots={fur:'毛色',body:'身体',inner:'耳内',ear:'耳朵',tail:'尾巴',tip:'尾尖',paw:'爪爪',hand:'手手',eye:'眼睛',blush:'腮红',belly:'腹毛',pad:'肉垫',mark:'花纹',cheek:'脸颊',chest:'胸毛',ink:'五官',head:'脑袋',wing:'翅膀',cap:'头冠',beak:'鸟嘴',feet:'脚',fin:'鱼鳍',coil:'盘身',gold:'金色部件',cream:'浅色花纹',mask:'面纹',ring:'尾环'};
const node=(tag,cls)=>{const e=document.createElement(tag);if(cls)e.className=cls;return e};
function button(text,fn,active=false){const e=node('button');e.type='button';e.textContent=text;e.setAttribute('aria-pressed',String(active));e.onclick=fn;return e}
export function mountCreatureEditor(root,art,getState,setState){
  let role='model',tab='body',action='idle',epoch=0;const paint=createCreatureRenderer(art);
  root.classList.add('creature-editor-box');
  const roles=node('div','row'),preview=node('img','creature-preview'),motions=node('div','row'),tabs=node('div','creature-panes'),content=node('div','creature-scroll'),status=node('p','muted');
  preview.alt='动物试穿';root.replaceChildren(roles,preview,motions,tabs,content,status);
  const color=(label,value,fn)=>{const e=node('label','palette');e.textContent=label;const i=node('input');i.type='color';i.value=value;i.onchange=()=>fn(i.value);e.append(i);return e};
  function apply(patch){try{setState(editAppearance(getState(),art.appearance,role,patch));status.textContent='';refresh()}catch(e){status.textContent=e.message}}
  function refresh(){
    const state=getState(),a=state[role],d=art.appearance[a.bodyId],token=++epoch;
    const toggle=node('label');const check=node('input');check.type='checkbox';check.checked=state.humanEnabled;check.onchange=()=>{setState({...getState(),humanEnabled:check.checked});refresh()};toggle.append(check,document.createTextNode('显示我的动物'));
    roles.replaceChildren(button('模型形象',()=>{role='model';refresh()},role==='model'),button('我的形象',()=>{role='human';refresh()},role==='human'),toggle);
    paint(a,action,{reducedMotion:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false}).then(u=>{if(token===epoch)preview.src=u}).catch(e=>{if(token===epoch)status.textContent=e.message});
    motions.replaceChildren(...ACTIONS.map(m=>button(actions[m],()=>{action=m;refresh()},m===action)));
    tabs.replaceChildren(...[['body','身体'],['colors','配色'],['accessories','配饰']].map(([id,title])=>button(title,()=>{tab=id;refresh()},tab===id)));
    content.replaceChildren();
    if(tab==='body'){const grid=node('div','catalog');for(const b of Object.values(art.creatures)){const item=button(b.name,()=>apply({bodyId:b.id}),b.id===a.bodyId),img=node('img');img.src=new URL('art/v1/'+b.file,import.meta.url).href;img.alt='';img.loading='lazy';item.prepend(img);grid.append(item)}content.append(grid)}
    if(tab==='colors'){const presets=node('div','row');for(const id of Object.keys(d.palettes))presets.append(button(names[id]??id,()=>{setState(editAppearance(getState(),art.appearance,role,{palette:id}));const st=getState();setState({...st,[role]:{...st[role],colors:{}}});refresh()},a.palette===id));const grid=node('div','creature-slots');for(const [key,value] of Object.entries(poseColors(d,a)))grid.append(color(slots[key]??key,value,v=>apply({colors:{[key]:v}})));content.append(presets,grid)}
    if(tab==='accessories'){const row=node('div','row');for(const k of GLASSES)row.append(button(glasses[k],()=>apply({glasses:k}),a.glasses===k));content.append(document.createTextNode('眼镜'),row,color('镜框',a.glassesColor,v=>apply({glassesColor:v})));
      if(d.neck){const n=node('div','row');for(const k of NECK)n.append(button(neck[k],()=>apply({neck:k}),a.neck===k));content.append(document.createElement('hr'),document.createTextNode('颈饰'),n,color('颈饰',a.neckColor,v=>apply({neckColor:v})))}
      for(const [k,label,enabled] of [['horn','蛇角',d.horn],['hat','睡帽',d.sleepHat],['tongue','吐信',d.horn]])if(enabled)content.append(button(label,()=>apply({[k]:!a[k]}),a[k]));
    }
  }
  return {refresh};
}
