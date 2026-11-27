// Pure room state. No chat, storage, network, or model side effects.
function ensure(ok,msg){if(!ok)throw new Error(msg)}

function finite(n){return typeof n==="number"&&Number.isFinite(n)}

function validId(s){return typeof s==="string"&&/^[A-Za-z0-9_-]{1,100}$/.test(s)}

function color(s){return typeof s==="string"&&/^#[0-9a-f]{6}$/i.test(s)}

function assetSize(a){const b=a.box??a.viewBox;ensure(Array.isArray(b)&&b.length===4&&b.every(finite)&&b[2]>0&&b[3]>0,"invalid asset size");return {width:b[2],height:b[3]}}

function buildCatalogue(roomDocs,extraDocs,presets){const assets=Object.create(null),rooms=Object.create(null);for(const r of roomDocs){ensure(validId(r.id)&&!rooms[r.id]&&finite(r.width)&&r.width>0&&finite(r.height)&&r.height>0,"invalid room");rooms[r.id]=r;ensure(r.order.length===r.assets.length&&new Set(r.order).size===r.order.length&&r.order.every(id=>r.assets.some(a=>a.id===id)),"invalid order")}for(const d of [...roomDocs,...extraDocs])for(const a of d.assets){ensure(validId(a.id)&&!assets[a.id],"duplicate asset");assetSize(a);const def=presets?.assets?.[a.id];assets[a.id]={...a,slots:def?.slots??a.colorSlots??{},presets:def?.presets??[],family:d.id??"extras"};}return {assets,rooms}}

function newLayout(cat){return {version:1,rooms:Object.fromEntries(Object.values(cat.rooms).map(r=>[r.id,r.order.map((assetId,i)=>({id:`${r.id}-${i+1}`,assetId,...cat.assets[assetId].defaultPlacement,colors:{},association:null}))]))}}

function getRoom(state,cat,id){ensure(Object.hasOwn(cat.rooms,id)&&Array.isArray(state.rooms[id]),"unknown room");return state.rooms[id]}

function getItem(list,id){const item=list.find(x=>x.id===id);ensure(item,"unknown instance");return item}

function cleanColors(a,values){const out={};for(const [k,v] of Object.entries(values??{})){ensure(Object.hasOwn(a.slots,k)&&color(v),"invalid color slot");out[k]=v.toLowerCase()}return out}

function cleanAssociation(v){if(v==null)return null;ensure(typeof v==="string"&&/^[a-z][a-z0-9-]{0,63}$/.test(v),"invalid association");return v}

function checkPlacement(p){ensure(finite(p.x)&&finite(p.y)&&Math.abs(p.x)<=10000&&Math.abs(p.y)<=10000&&finite(p.scale)&&p.scale>=.1&&p.scale<=4&&typeof p.mirror==="boolean"&&typeof p.visible==="boolean","invalid placement");return p}

function editLayout(state,cat,roomId,op){const list=getRoom(state,cat,roomId).map(x=>({...x,colors:{...x.colors}})),r=cat.rooms[roomId];const result=()=>({...state,rooms:{...state.rooms,[roomId]:list}});if(op.type==="reset")return {...state,rooms:{...state.rooms,[roomId]:newLayout(cat).rooms[roomId]}};if(op.type==="add"){ensure(validId(op.id)&&!list.some(i=>i.id===op.id),"duplicate instance");ensure(list.length<150,"room full");const a=cat.assets[op.assetId];ensure(a,"unknown asset");const {width,height}=assetSize(a);const scale=a.defaultPlacement?.scale??Math.min(.55, r.width*.26/width,r.height*.26/height);list.push({id:op.id,assetId:a.id,x:(r.width-width*scale)/2,y:(r.height-height*scale)/2,scale,mirror:false,visible:true,colors:{},association:null});return result()}const item=getItem(list,op.id),a=cat.assets[item.assetId];switch(op.type){case"move":item.x=op.x;item.y=op.y;break;case"scale":item.scale=op.scale;break;case"mirror":item.mirror=!item.mirror;break;case"visible":item.visible=!item.visible;break;case"delete":list.splice(list.indexOf(item),1);break;case"copy":ensure(validId(op.newId)&&!list.some(i=>i.id===op.newId)&&list.length<150,"invalid copy");list.splice(list.indexOf(item)+1,0,checkPlacement({...item,id:op.newId,x:item.x+8,y:item.y+8,colors:{...item.colors}}));break;case"layer":{const i=list.indexOf(item);ensure(["up","down","top","bottom"].includes(op.direction),"invalid layer");const j=op.direction==="top"?list.length-1:op.direction==="bottom"?0:Math.max(0,Math.min(list.length-1,i+(op.direction==="up"?1:-1)));list.splice(i,1);list.splice(j,0,item);break}case"color":ensure(a,"missing asset");item.colors={...item.colors,...cleanColors(a,op.values)};break;case"original":item.colors={};break;case"associate":item.association=cleanAssociation(op.value);break;default:throw Error("unknown edit")}checkPlacement(item);return result()}

function restoreLayout(raw,cat){ensure(raw?.version===1&&raw.rooms&&typeof raw.rooms==="object","invalid layout version");const defaults=newLayout(cat),rooms={};for(const id of Object.keys(cat.rooms)){const list=raw.rooms[id]??defaults.rooms[id];ensure(Array.isArray(list)&&list.length<=150,"invalid room list");const seen=new Set();rooms[id]=list.map(x=>{ensure(validId(x.id)&&validId(x.assetId)&&!seen.has(x.id),"invalid instance");seen.add(x.id);const a=cat.assets[x.assetId];const colors=a?cleanColors(a,x.colors):Object.fromEntries(Object.entries(x.colors??{}).filter(([k,v])=>validId(k)&&color(v)));return checkPlacement({id:x.id,assetId:x.assetId,x:x.x,y:x.y,scale:x.scale,mirror:x.mirror,visible:x.visible,colors,association:cleanAssociation(x.association)})})}return {version:1,rooms}}

function anchorPosition(cat,item,anchorId){const a=cat.assets[item.assetId];if(!item.visible||!a)return null;const p=a.anchors?.find(x=>x.id===anchorId);if(!p)return null;const {width}=assetSize(a);return {x:item.x+(item.mirror?width-p.x:p.x)*item.scale,y:item.y+p.y*item.scale,action:p.action}}

function sceneLayers(state,cat,roomId,occupants=[]){ensure(Array.isArray(occupants)&&occupants.length<=2&&new Set(occupants.map(o=>o.role)).size===occupants.length&&occupants.every(o=>["model","human"].includes(o.role)),"invalid occupants");const list=getRoom(state,cat,roomId),out=[],assigned=new Set(),placed=new Set();for(const i of list){if(!i.visible)continue;const a=cat.assets[i.assetId];out.push({kind:a?"furniture":"missing",part:a?.hasFront?"back":"whole",item:i});for(const o of occupants){if(o.instanceId!==i.id)continue;const p=anchorPosition(cat,i,o.anchorId);const key=i.id+":"+o.anchorId;if(p&&!assigned.has(key)){assigned.add(key);placed.add(o.role);out.push({kind:"creature",role:o.role,creatureId:o.creatureId,...p})}}if(a?.hasFront)out.push({kind:"furniture",part:"front",item:i})}return {layers:out,unplaced:occupants.filter(o=>!placed.has(o.role)).map(o=>o.role)}}
export {assetSize,buildCatalogue,newLayout,editLayout,restoreLayout,anchorPosition,sceneLayers};
