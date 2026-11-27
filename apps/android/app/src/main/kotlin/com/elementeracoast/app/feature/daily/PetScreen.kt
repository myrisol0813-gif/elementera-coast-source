package com.elementeracoast.app.feature.daily

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.restbox.*
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import android.os.SystemClock
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

private const val MAX_STUDIO_JSON = 1_000_000
private val roomNames = mapOf("living" to "客厅", "study" to "书房", "bedroom" to "卧室", "extras" to "其他家具")
private val actionNames = mapOf("idle" to "待机", "cling" to "贴贴", "cheer" to "开心", "sad" to "低落", "sit" to "坐下", "sleep" to "睡觉")
private data class StudioMotionRequest(val id:String,val appearance:RestAppearance,val action:String,val prop:String?)
private data class StudioResources(
    val cat: NativeSceneCatalogue, val appearance: RestAppearanceCatalogue,
    val names: Map<String,String>, val policy: NativeStudioPolicy, val atlas: NativeRestSprites,
    val loaded:NativeStudioLoad,
)

@Composable
internal fun PetScreen() {
    val context = LocalContext.current
    val result by produceState<Result<StudioResources>?>(null, context) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                val repo = RestArtRepository(context.assets)
                val cat = NativeSceneCatalogue.load(repo)
                val appearance = repo.appearance()
                val names = repo.manifest(repo.index().getValue("creatures").jsonPrimitive.content)
                    .getValue("bodies").jsonArray.associate {
                        val b=it.jsonObject
                        b.getValue("id").jsonPrimitive.content to b.getValue("name").jsonPrimitive.content
                    }
                val policy=NativeStudioPolicy(cat,appearance)
                StudioResources(cat,appearance,names,policy,NativeRestSprites(context.assets),NativeStudioStore(context).load(policy))
            }
        }
    }
    val ready = result
    if (ready == null) Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) { CircularProgressIndicator() }
    else ready.fold(onSuccess={ NativeStudioPage(it) },onFailure={
        Box(Modifier.fillMaxSize().padding(24.dp),contentAlignment=Alignment.Center) {
            Text("造物间资源未能载入：${it.message.orEmpty()}",color=MaterialTheme.colorScheme.error)
        }
    })
}

@Composable
private fun NativeStudioPage(r: StudioResources) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember(context) { NativeStudioStore(context) }
    val raw = r.loaded.raw
    val restored = remember(r,raw) { raw?.let { runCatching { r.policy.decode(it) } } }
    var state by remember(r) { mutableStateOf(restored?.getOrNull() ?: r.policy.fresh()) }
    var recovery by remember(r) { mutableStateOf(restored?.isFailure==true||r.loaded.warning!=null) }
    var editing by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<String?>(null) }
    var family by remember { mutableStateOf(state.room) }
    var panel by remember { mutableStateOf("room") }
    var role by remember { mutableStateOf("model") }
    var action by remember { mutableStateOf("idle") }
    var prop by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var confirmation by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(if(r.loaded.migrated)"已恢复旧版造物间资料" else null) }
    var pendingExport by remember { mutableStateOf<String?>(null) }
    var pendingImport by remember { mutableStateOf<NativeStudioState?>(null) }
    fun persist() {
        if (!recovery) runCatching { store.save(r.policy.encode(state)) }.onFailure { message="保存失败，请导出备份" }
    }
    fun change(next: NativeStudioState) { state=next; persist() }
    fun editItem(transform: (NativeFurniture)->NativeFurniture) {
        val id=selected ?: return
        runCatching { change(r.policy.edit(state,id,transform)) }.onFailure { message=it.message ?: "无法修改家具" }
    }
    fun changeAppearance(value: RestAppearance) {
        val h=state.household
        val next=if(role=="model")h.copy(model=value) else h.copy(human=value)
        runCatching { change(r.policy.validate(state.copy(household=next))) }.onFailure { message="无效的动物形象设置" }
    }
    val pick=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if(uri!=null) scope.launch {
            val res=withContext(Dispatchers.IO) {
                runCatching {
                    val bytes=context.contentResolver.openInputStream(uri)?.use { input ->
                        val output=java.io.ByteArrayOutputStream()
                        val buf=ByteArray(8192)
                        while(true) { val n=input.read(buf); if(n<0)break; require(output.size()+n<=MAX_STUDIO_JSON);output.write(buf,0,n) }
                        output.toByteArray()
                    } ?: error("无法读取文件")
                    bytes.toString(Charsets.UTF_8)
                }
            }.mapCatching { r.policy.import(it,state) }
            res.fold(onSuccess={pendingImport=it;confirmation="import"},onFailure={message="导入失败，当前房间未改变"})
        }
    }
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val value=pendingExport; pendingExport=null
        if(uri!=null && value!=null) scope.launch {
            val result=withContext(Dispatchers.IO){runCatching{
                context.contentResolver.openOutputStream(uri,"wt")?.use { it.write(value.toByteArray(Charsets.UTF_8)) } ?: error("无法打开文件")
            }}
            message=if(result.isSuccess)"已导出造物间" else "导出失败"
        }
    }
    val items=r.policy.items(state)
    val occupants=r.policy.occupants(state)
    val scene=r.cat.layers(state.room,items,occupants)
    val keys=buildSet {
        for(layer in scene)when(layer) {
            is NativeSceneLayer.Environment -> add(r.atlas.environmentKey(layer.path))
            is NativeSceneLayer.Furniture -> layer.asset?.let { a ->
                add(r.atlas.furnitureKey(a,layer.part,emptyMap()))
                add(r.atlas.furnitureKey(a,layer.part,layer.item.colors))
            }
            is NativeSceneLayer.Occupant -> {
                val a=if(layer.role=="model")state.household.model else state.household.human
                add(r.atlas.baseCreatureKey(a,layer.anchor.action));add(r.atlas.creatureKey(a,layer.anchor.action))
            }
        }
        if(editing && panel=="room")r.cat.assets.values.filter{it.family==family}.forEach { add(r.atlas.furnitureKey(it,NativePaintPart.WHOLE,emptyMap())) }
        if(panel=="appearance") {
            val a=if(role=="model")state.household.model else state.household.human
            add(r.atlas.baseCreatureKey(a,action));add(r.atlas.creatureKey(a,action,prop))
        }
    }
    val bitmaps by produceState<Map<String,android.graphics.Bitmap>>(emptyMap(),r.atlas,keys) {
        value=withContext(Dispatchers.IO){r.atlas.load(keys)}
    }
    val roomMotionKeys=if(panel=="room"&&!editing)r.atlas.roomMotionKeys(scene)else emptyList()
    val motionRequests=remember(panel,role,action,prop,state.household,occupants,scene){
        if(panel=="appearance")listOf(StudioMotionRequest("preview",if(role=="model")state.household.model else state.household.human,action,prop))
        else scene.filterIsInstance<NativeSceneLayer.Occupant>().map{layer->
            StudioMotionRequest(layer.role,if(layer.role=="model")state.household.model else state.household.human,layer.anchor.action,null)
        }
    }
    val moving by produceState<Map<String,android.graphics.Bitmap>>(emptyMap(),r.atlas,motionRequests,state.reducedMotion,panel,roomMotionKeys){
        value=emptyMap()
        if(state.reducedMotion||(motionRequests.isEmpty()&&roomMotionKeys.isEmpty()))return@produceState
        val start=SystemClock.uptimeMillis()
        var roomCursor=0
        val retained=linkedMapOf<String,android.graphics.Bitmap>()
        while(isActive) {
            val elapsed=SystemClock.uptimeMillis()-start
            val frames=withContext(Dispatchers.Default){
                motionRequests.mapNotNull{req->
                    r.atlas.motionFrame(req.appearance,req.action,req.prop,elapsed,if(req.id=="preview")384 else 192)?.let{req.id to it}
                }.toMap()
            }
            // Round-robin one independently moving furniture/environment layer per tick.
            // Do not rasterize every painted object for every frame.
            if(roomMotionKeys.isNotEmpty()){
                val key=roomMotionKeys[roomCursor++ % roomMotionKeys.size]
                val frame=withContext(Dispatchers.Default){r.atlas.roomMotionFrame(key,elapsed)}
                if(frame!=null)retained[key]=frame
            }
            value=retained.toMap()+frames
            delay(125)
        }
    }
    val images=remember(r.atlas,bitmaps,state.household,moving){NativeRestSpriteSnapshot(r.atlas,bitmaps,state.household,moving)}
    val unsupported = items.count { item -> item.visible && r.cat.assets[item.assetId]?.let {
        !r.atlas.has(r.atlas.furnitureKey(it,NativePaintPart.WHOLE,item.colors))
    } != false }
    val incompleteAppearance = keys.any{it.startsWith("cc|") && it !in bitmaps}
    val missing = keys.count { r.atlas.has(it) && it !in bitmaps }
    val selectedItem=items.firstOrNull{it.id==selected}
    val chosenAsset=selectedItem?.let{r.cat.assets[it.assetId]}

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=12.dp,vertical=8.dp),
        verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)) {
            for((id,name) in roomNames.filterKeys { it in r.cat.rooms }) {
                FilterChip(selected=state.room==id,onClick={change(state.copy(room=id)); selected=null;family=id;panel="room"},label={Text(name)},modifier=Modifier.weight(1f))
            }
            Box {
                TextButton(onClick={menu=true}) { Text("⋯") }
                DropdownMenu(expanded=menu,onDismissRequest={menu=false}) {
                    DropdownMenuItem(text={Text("导出房间与形象")},onClick={menu=false;pendingExport=r.policy.export(state);save.launch("rest-box-layout.json")})
                    DropdownMenuItem(text={Text("导入房间与形象")},onClick={menu=false;pick.launch(arrayOf("application/json","text/plain","application/octet-stream"))})
                    if(recovery && raw!=null)DropdownMenuItem(text={Text("导出旧存档原件")},onClick={menu=false;pendingExport=raw;save.launch("rest-box-recovery.json")})
                    if(recovery)DropdownMenuItem(text={Text("保留旧资料，启用新房间保存")},onClick={menu=false;confirmation="new-save"})
                    DropdownMenuItem(text={Text(if(state.reducedMotion)"播放动画" else "暂停动画")},onClick={menu=false;change(state.copy(reducedMotion=!state.reducedMotion))})
                    DropdownMenuItem(text={Text("恢复当前房间")},onClick={menu=false;confirmation="reset"})
                }
            }
        }
        if(recovery)Text(r.loaded.warning?:"原生旧存档无法读取，自动保存已暂停。可导出原件或导入有效备份。",color=MaterialTheme.colorScheme.error)
        if(panel=="room") {
            // The scene is directly in the native page; no independent themed document.
            NativeRestScene(r.cat,state.room,items,occupants,images,editing,selected,
                onSelect={selected=it},
                onMove={id,x,y-> state=state.copy(layout=state.layout.copy(rooms=state.layout.rooms+(state.room to r.policy.items(state).map{if(it.id==id)it.copy(x=x,y=y)else it})))},
                onMoveFinished={persist()})
            if(missing>0)Text("正在准备场景素材；若持续缺失，当前自定义图层尚未正确绘制。",style=MaterialTheme.typography.bodySmall)
            if(unsupported>0 || incompleteAppearance)Text("此施工版暂按原稿显示尚未支持的自定义外观，原有设置保留。",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                FilterChip(selected=editing,onClick={editing=!editing;selected=null},label={Text(if(editing)"完成布置" else "布置房间")},modifier=Modifier.weight(1f))
                FilterChip(selected=state.pets,onClick={change(state.copy(pets=!state.pets))},label={Text("动物坐卧")},modifier=Modifier.weight(1f))
                OutlinedButton(onClick={panel="appearance"},modifier=Modifier.weight(1f),contentPadding=PaddingValues(2.dp)){Text("动物形象")}
            }
            if(state.pets) {
                val slots=r.policy.slots(items)
                val options=listOf("" to "自动选择","none" to "不展示")+slots.map{it.key to (it.name+" · "+(actionNames[it.action]?:it.action))}
                for(petRole in listOf("model","human").filter{it=="model"||state.household.humanEnabled}) {
                    NativeStudioChoice(if(petRole=="model")"模型动物" else "我的动物",state.poseChoices[state.room]?.get(petRole).orEmpty(),options) { choice ->
                        change(state.copy(poseChoices=state.poseChoices+(state.room to (state.poseChoices[state.room].orEmpty()+(petRole to choice)))))
                    }
                }
            }
            if(editing) {
                StudioSection {
                    Text(chosenAsset?.name ?: if(selectedItem!=null)"素材缺失" else "点选房间中的家具",style=MaterialTheme.typography.titleSmall)
                    if(selectedItem!=null) {
                        Text("大小 · ${(selectedItem.scale*100).toInt()}%")
                        Slider(value=selectedItem.scale.toFloat(),onValueChange={ scale->
                            state=state.copy(layout=state.layout.copy(rooms=state.layout.rooms+(state.room to r.policy.items(state).map{if(it.id==selected)it.copy(scale=scale.toDouble())else it})))
                        },onValueChangeFinished={persist()},valueRange=.1f..4f)
                        Row(horizontalArrangement=Arrangement.spacedBy(3.dp)) {
                            TextButton(onClick={editItem{it.copy(mirror=!it.mirror)}}){Text("镜像")}
                            TextButton(onClick={editItem{it.copy(visible=!it.visible)}}){Text(if(selectedItem.visible)"隐藏" else "显示")}
                            TextButton(onClick={runCatching{r.policy.duplicate(state,selectedItem.id)}.onSuccess{(next,id)->change(next);selected=id}.onFailure{message="无法复制"}}){Text("复制")}
                            TextButton(onClick={confirmation="delete"}){Text("移除")}
                        }
                        Row(horizontalArrangement=Arrangement.spacedBy(3.dp)) {
                            for((dir,label) in listOf("top" to "置顶","up" to "上移","down" to "下移","bottom" to "置底"))TextButton(onClick={change(r.policy.reorder(state,selectedItem.id,dir))}){Text(label)}
                        }
                        if(chosenAsset!=null && chosenAsset.colorSlots.isNotEmpty()) {
                            Text("配色")
                            NativeStudioChoice("预设",chosenAsset.presets.firstOrNull{it.colors==selectedItem.colors}?.name.orEmpty(),
                                listOf("" to "原稿")+chosenAsset.presets.map{it.name to it.name}){ name->
                                editItem{it.copy(colors=chosenAsset.presets.firstOrNull{p->p.name==name}?.colors.orEmpty())}
                            }
                            for((slot,meta) in r.atlas.colorSlots(chosenAsset)) {
                                NativeStudioColor(meta.first,selectedItem.colors[slot]?:meta.second){ color->
                                    editItem{it.copy(colors=it.colors+(slot to color))}
                                }
                            }
                            TextButton(onClick={editItem{it.copy(colors=emptyMap())}}){Text("恢复原稿配色")}
                        }
                    }
                }
                StudioSection {
                    Text("家具库",style=MaterialTheme.typography.titleSmall)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(3.dp)) {
                        for((id,name) in roomNames)FilterChip(selected=family==id,onClick={family=id},label={Text(if(id=="extras")"其他" else name)},modifier=Modifier.weight(1f))
                    }
                    for(group in r.cat.assets.values.filter{it.family==family}.chunked(3))Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                        for(a in group)Column(Modifier.weight(1f).clickable {
                            runCatching{r.policy.add(state,a.id)}.onSuccess{(next,id)->change(next);selected=id}.onFailure{message="无法添加家具"}
                        }.padding(4.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                            val bitmap=bitmaps[r.atlas.furnitureKey(a,NativePaintPart.WHOLE,emptyMap())]
                            if(bitmap!=null)Image(bitmap.asImageBitmap(),contentDescription=a.name,Modifier.fillMaxWidth().height(72.dp),contentScale=ContentScale.Fit)
                            else Spacer(Modifier.height(72.dp))
                            Text(a.name,style=MaterialTheme.typography.labelSmall)
                        }
                        repeat(3-group.size){Spacer(Modifier.weight(1f))}
                    }
                }
                StudioSection {
                    Text("图层 · 前景在上",style=MaterialTheme.typography.titleSmall)
                    for(i in items.asReversed())Row(Modifier.fillMaxWidth().clickable{selected=i.id}.padding(vertical=5.dp),verticalAlignment=Alignment.CenterVertically) {
                        RadioButton(selected=selected==i.id,onClick={selected=i.id})
                        Text((if(i.visible)"" else "〔隐藏〕")+(r.cat.assets[i.assetId]?.name?:"素材缺失"),modifier=Modifier.weight(1f))
                    }
                }
            }
        } else {
            TextButton(onClick={panel="room"}){Text("‹ 返回房间")}
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                FilterChip(selected=role=="model",onClick={role="model"},label={Text("模型动物")},modifier=Modifier.weight(1f))
                FilterChip(selected=role=="human",onClick={role="human"},label={Text("我的动物")},modifier=Modifier.weight(1f))
            }
            val a=if(role=="model")state.household.model else state.household.human
            val def=r.appearance.bodies.getValue(a.bodyId)
            val bitmap=moving["preview"]?:bitmaps[r.atlas.creatureKey(a,action,prop)]?:bitmaps[r.atlas.baseCreatureKey(a,action)]
            Box(Modifier.fillMaxWidth().height(220.dp),contentAlignment=Alignment.Center) {
                if(bitmap!=null)Image(bitmap.asImageBitmap(),contentDescription=r.names[a.bodyId],modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Fit)
            }
            StudioSection {
                if(role=="human")Row(verticalAlignment=Alignment.CenterVertically){Text("启用我的动物",Modifier.weight(1f));Switch(checked=state.household.humanEnabled,onCheckedChange={change(state.copy(household=state.household.copy(humanEnabled=it)))})}
                NativeStudioChoice("动物",a.bodyId,r.names.entries.map{it.key to it.value}) { body-> prop=null;changeAppearance(RestAppearancePolicy.chooseBody(r.appearance,a,body)) }
                NativeStudioChoice("配色",a.palette,def.palettes.keys.map{it to it}){palette->changeAppearance(a.copy(palette=palette,colors=emptyMap()))}
                NativeStudioChoice("动作",action,actionNames.entries.map{it.key to it.value}){action=it;if(it=="sleep")prop=null}
                val props=remember(a.bodyId,a.palette,action){r.atlas.propOptions(a,action)}
                if(props.isNotEmpty())NativeStudioChoice("手持道具",prop.orEmpty(),listOf("" to "不拿道具")+props.map{it to (mapOf("book" to "书","flower" to "花","cookie" to "饼干","tea" to "茶","letter" to "信")[it]?:it)}){prop=it.takeIf{v->v.isNotEmpty()}}
                if(incompleteAppearance)Text("正在绘制自定义形象，失败时保留原稿与设置。",color=MaterialTheme.colorScheme.error)
                NativeStudioSwitch("播放动画",!state.reducedMotion){change(state.copy(reducedMotion=!it))}
                Text("原稿动画轨道以节能频率预览，连续动作保真仍待验收。",style=MaterialTheme.typography.bodySmall)
            }
            StudioSection {
                Text("身体配色",style=MaterialTheme.typography.titleSmall)
                val colors=RestAppearancePolicy.colors(r.appearance,a)
                val colorNames=mapOf("fur" to "毛色","body" to "身体","inner" to "耳内","ear" to "耳朵","tail" to "尾巴","tip" to "尾尖","paw" to "爪爪","hand" to "手手","eye" to "眼睛","blush" to "腮红","belly" to "腹毛","pad" to "肉垫","mark" to "花纹","cheek" to "脸颊","chest" to "胸毛","ink" to "五官","head" to "脑袋","wing" to "翅膀","cap" to "头冠","beak" to "鸟嘴","feet" to "脚","fin" to "鱼鳍","coil" to "盘身","gold" to "金色部件","cream" to "浅色花纹","mask" to "面纹","ring" to "尾环")
                for((slot,color) in colors)NativeStudioColor(colorNames[slot]?:slot,color){v->changeAppearance(a.copy(colors=a.colors+(slot to v)))}
                TextButton(onClick={changeAppearance(a.copy(colors=emptyMap()))}){Text("恢复此配色原色")}
            }
            StudioSection {
                Text("配饰",style=MaterialTheme.typography.titleSmall)
                NativeStudioChoice("眼镜",a.glasses,listOf("none" to "无","round" to "圆框","square" to "方框","sun" to "墨镜","mono" to "单片")){changeAppearance(a.copy(glasses=it))}
                if(a.glasses!="none")NativeStudioColor("镜框颜色",a.glassesColor){changeAppearance(a.copy(glassesColor=it))}
                if(def.neck){
                    NativeStudioChoice("颈饰",a.neck,listOf("none" to "无","tie" to "领带","bow" to "领结","scarf" to "围巾")){changeAppearance(a.copy(neck=it))}
                    if(a.neck!="none")NativeStudioColor("颈饰颜色",a.neckColor){changeAppearance(a.copy(neckColor=it))}
                }
                NativeStudioChoice("徽章",a.badge,listOf("none" to "无","gpt" to "GPT","claude" to "Claude","deepseek" to "DeepSeek","gemini" to "Gemini","grok" to "Grok")){changeAppearance(a.copy(badge=it))}
                if(a.badge!="none"){
                    NativeStudioChoice("徽章位置",a.badgePlace,listOf("head" to "头上","chest" to "胸口／侧身")){changeAppearance(a.copy(badgePlace=it,badgeX=0.0,badgeY=0.0,badgeSize=100.0))}
                    NativeStudioChoice("徽章颜色",a.badgeMode,listOf("original" to "原色","custom" to "自定义")){changeAppearance(a.copy(badgeMode=it))}
                    if(a.badgeMode=="custom")NativeStudioColor("自定义颜色",a.badgeColor){changeAppearance(a.copy(badgeColor=it))}
                    NativeStudioAdjust("左右",a.badgeX,-80f..80f){changeAppearance(a.copy(badgeX=it))}
                    NativeStudioAdjust("上下",a.badgeY,-80f..80f){changeAppearance(a.copy(badgeY=it))}
                    NativeStudioAdjust("大小",a.badgeSize,30f..200f){changeAppearance(a.copy(badgeSize=it))}
                    TextButton(onClick={changeAppearance(a.copy(badgeX=0.0,badgeY=0.0,badgeSize=100.0))}){Text("复原徽章位置")}
                }
                if(def.horn)NativeStudioSwitch("蛇角",a.horn){changeAppearance(a.copy(horn=it))}
                if(def.sleepHat)NativeStudioSwitch("睡帽",a.hat){changeAppearance(a.copy(hat=it))}
                if(def.horn)NativeStudioSwitch("吐信",a.tongue){changeAppearance(a.copy(tongue=it))}
            }
        }
        Text("${roomNames[state.room]} · ${items.size} 件家具",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(message!=null)Text(message.orEmpty(),style=MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(20.dp))
    }
    if(confirmation!=null)AlertDialog(onDismissRequest={confirmation=null;pendingImport=null},
        title={Text(when(confirmation){"reset"->"恢复当前房间？";"delete"->"移除这件家具？";"new-save"->"开始保存新的造物间？";else->"导入并替换当前造物间？"})},
        text={Text(when(confirmation){"import"->"将替换房间布局与备份中的动物形象；不会删除其他海岸数据。";"new-save"->"原有网页存储不会删除；此后保存当前原生布局，不再自动覆盖它。";else->"只修改当前房间。"})},
        confirmButton={TextButton(onClick={
            when(confirmation){
                "reset"->{change(r.policy.resetRoom(state));selected=null}
                "delete"->{selected?.let{change(r.policy.remove(state,it))};selected=null}
                "import"->{pendingImport?.let{next->runCatching{if(recovery&&raw!=null)store.preserve(raw);store.save(r.policy.encode(next))}.onSuccess{state=next;recovery=false;selected=null;message="已导入房间"}.onFailure{message="导入未保存，原资料保留"}};pendingImport=null}
                "new-save"->{runCatching{if(raw!=null)store.preserve(raw);store.save(r.policy.encode(state))}.onSuccess{recovery=false;message="已启用原生房间保存"}.onFailure{message="保存未确认，旧资料保留"}}
            }
            confirmation=null
        }){Text("确认")}},
        dismissButton={TextButton(onClick={confirmation=null;pendingImport=null}){Text("取消")}})
}

@Composable
private fun StudioSection(content: @Composable ColumnScope.()->Unit) {
    SnowLetterSurface(modifier=Modifier.fillMaxWidth(),role=SnowLetterSurfaceRole.StatusCard,
        fallbackColor=MaterialTheme.colorScheme.surfaceVariant,fallbackShape=RoundedCornerShape(16.dp)) {
        Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp),content=content)
    }
}
@Composable
private fun NativeStudioChoice(label:String,selected:String,options:List<Pair<String,String>>,onChoose:(String)->Unit) {
    var expanded by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
        Box {
            OutlinedButton(onClick={expanded=true}){Text(options.firstOrNull{it.first==selected}?.second?:selected)}
            DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){
                for((id,name) in options)DropdownMenuItem(text={Text(name)},onClick={expanded=false;onChoose(id)})
            }
        }
    }
}

@Composable
private fun NativeStudioColor(label:String,value:String,onChoose:(String)->Unit) {
    var open by remember { mutableStateOf(false) }
    val color=runCatching{Color(android.graphics.Color.parseColor(value))}.getOrDefault(Color.Gray)
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick={open=true},contentPadding=PaddingValues(horizontal=10.dp,vertical=4.dp)) {
            Box(Modifier.size(20.dp).background(color,RoundedCornerShape(5.dp)))
            Spacer(Modifier.width(8.dp))
            Text(value.uppercase(),style=MaterialTheme.typography.labelMedium)
        }
    }
    if(open) {
        var text by remember(value){mutableStateOf(value)}
        val valid=Regex("^#[0-9a-fA-F]{6}$").matches(text)
        val current=if(valid)Color(android.graphics.Color.parseColor(text))else color
        fun component(channel:Int,f:Float) {
            val old=android.graphics.Color.parseColor(if(valid)text else value)
            val rgb=intArrayOf(android.graphics.Color.red(old),android.graphics.Color.green(old),android.graphics.Color.blue(old))
            rgb[channel]=f.toInt().coerceIn(0,255)
            text="#"+rgb.joinToString(""){it.toString(16).padStart(2,'0')}
        }
        AlertDialog(onDismissRequest={open=false},title={Text(label)},text={
            Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Box(Modifier.fillMaxWidth().height(48.dp).background(current,RoundedCornerShape(8.dp)))
                OutlinedTextField(value=text,onValueChange={text=it.take(7)},singleLine=true,
                    label={Text("HEX")},isError=!valid)
                for((index,name) in listOf("红","绿","蓝").withIndex()) {
                    Text(name,style=MaterialTheme.typography.labelSmall)
                    val channels=listOf(current.red,current.green,current.blue)
                    Slider(value=channels[index]*255f,onValueChange={component(index,it)},valueRange=0f..255f)
                }
            }
        },confirmButton={TextButton(enabled=valid,onClick={onChoose(text.lowercase());open=false}){Text("应用")}},
            dismissButton={TextButton(onClick={open=false}){Text("取消")}})
    }
}

@Composable
private fun NativeStudioSwitch(label:String,checked:Boolean,onChange:(Boolean)->Unit){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Text(label,Modifier.weight(1f));Switch(checked=checked,onCheckedChange=onChange)
    }
}
@Composable
private fun NativeStudioAdjust(label:String,value:Double,range:ClosedFloatingPointRange<Float>,onChange:(Double)->Unit){
    var draft by remember(value){mutableFloatStateOf(value.toFloat().coerceIn(range.start,range.endInclusive))}
    Text("$label · ${draft.toInt()}",style=MaterialTheme.typography.bodySmall)
    Slider(value=draft,onValueChange={draft=it},onValueChangeFinished={onChange(draft.toDouble())},valueRange=range)
}
