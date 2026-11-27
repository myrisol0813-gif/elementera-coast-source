package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.remote.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private fun stamp(value:Long):String=Instant.ofEpochMilli(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
private fun status(value:String)=when(value){
    "running"->"活动中";"completed"->"已结束";"failed"->"未完成";"cancelled"->"已取消";"interrupted"->"已中断";"claimed"->"结果未确认";else->value
}
private fun toolName(value:String)=when(value){
    "voice_create"->"自主语音";"image_generate"->"自主生图";"dream_memory_candidate"->"提议记忆候选";"dream_read_history"->"阅读历史";"dream_write_note"->"写自主手记";"dream_schedule_extra"->"提议额外唤醒";else->value
}
private fun JsonElement?.field(key:String):String?=((this as? JsonObject)?.get(key) as? JsonPrimitive)?.contentOrNull

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DreamTideSheet(cid:String,selectedModel:String,localMode:Boolean,api:CoastApiClient,initialTab:Int=0,onDismiss:()->Unit){
    val scope=rememberCoroutineScope()
    var tab by remember(cid,initialTab){mutableStateOf(initialTab.coerceIn(0,2))}
    var loaded by remember(cid){mutableStateOf(false)}
    var busy by remember(cid){mutableStateOf(false)}
    var error by remember(cid){mutableStateOf("")}
    var notice by remember(cid){mutableStateOf("")}
    var response by remember(cid){mutableStateOf(DreamSettingsResponse())}
    var cfg by remember(cid){mutableStateOf(DreamConfig(timeZone=ZoneId.systemDefault().id))}
    var execution by remember(cid){mutableStateOf(DreamExecutionConfig())}
    var model by remember(cid){mutableStateOf(selectedModel)}
    var quiet by remember(cid){mutableStateOf(false)}
    var quietStart by remember(cid){mutableStateOf("23:00")}
    var quietEnd by remember(cid){mutableStateOf("07:00")}
    var tokenText by remember(cid){mutableStateOf("8000")}
    var outputText by remember(cid){mutableStateOf("1000")}
    var toolsText by remember(cid){mutableStateOf("4")}
    var readText by remember(cid){mutableStateOf("10")}
    var extraText by remember(cid){mutableStateOf("0")}
    var voiceLimitText by remember(cid){mutableStateOf("1")}
    var imageLimitText by remember(cid){mutableStateOf("1")}
    var consent by remember(cid){mutableStateOf(false)}
    var softConsent by remember(cid){mutableStateOf(false)}
    var planLimitText by remember(cid){mutableStateOf("5")}
    var notePage by remember(cid){mutableStateOf(DreamNotesResponse())}
    var activityPage by remember(cid){mutableStateOf(DreamActivityResponse())}
    var previewId by remember(cid){mutableStateOf<String?>(null)}
    var offset by remember(cid){mutableStateOf(0)}
    val sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true)
    fun hydrate(value:DreamSettingsResponse){
        response=value
        cfg=value.settings.config?:DreamConfig(timeZone=ZoneId.systemDefault().id)
        execution=cfg.execution?:DreamExecutionConfig()
        model=value.settings.modelId?:selectedModel
        quiet=cfg.quietHours!=null
        quietStart=cfg.quietHours?.start?:"23:00";quietEnd=cfg.quietHours?.end?:"07:00"
        tokenText=execution.tokenBudget.toString();outputText=execution.outputLimit.toString()
        toolsText=execution.toolBudget.toString();readText=execution.readTurns.toString();extraText=execution.extraPerDay.toString();voiceLimitText=execution.voiceLimit.toString();imageLimitText=execution.imageLimit.toString()
        planLimitText=(value.planRequestLimit?:5).toString()
        consent=false;softConsent=false;loaded=true
    }
    suspend fun load(){
        busy=true;error=""
        try{
            when(tab){
                0->hydrate(api.dreamSettings(cid))
                1->notePage=api.dreamNotes(cid,offset)
                2->activityPage=api.dreamActivity(cid,offset)
            }
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"读取未完成。"}
        finally{busy=false}
    }
    LaunchedEffect(cid,tab,offset){load()}
    previewId?.let{id->DreamMediaPreview(api,cid,id){previewId=null}}
    val canArm=response.executionAvailable&&response.schedulerConfigured
    val planDraft=model.startsWith("chatgpt-plan:")
    val canArmSelected=canArm&&(!planDraft||localMode&&response.planExecutionAvailable)
    fun save(action:String){
        if(busy||!loaded)return
        val e=if(action=="disarm")null else {
            val t=tokenText.toIntOrNull();val o=outputText.toIntOrNull();val u=toolsText.toIntOrNull()
            val r=readText.toIntOrNull();val x=extraText.toIntOrNull()
            val v=voiceLimitText.toIntOrNull();val i=imageLimitText.toIntOrNull()
            val fields=listOf(Triple("单次累计 token 预算",t,1),Triple("每次请求输出",o,1),Triple("单次工具调用上限",u,0),Triple("每次阅读最大轮数",r,1),Triple("每日额外次数上限",x,0),Triple("语音尝试上限",v,0),Triple("生图尝试上限",i,0))
            val invalid=fields.firstOrNull{(_,value,min)->value==null||value<min||value==Int.MAX_VALUE}
            if(invalid!=null){error=invalid.first+"：请输入 "+invalid.third+"–2147483646 的整数。";return}
            if(execution.invitation.isBlank()||execution.invitation.length>16000){error="唤醒邀请词须为 1–16000 字符。";return}
            if(model.isBlank()||model.length>180){error="绑定模型 ID 须为 1–180 字符。";return}
            execution.copy(tokenBudget=t!!,outputLimit=o!!,toolBudget=u!!,readTurns=r!!,extraPerDay=x!!,voiceLimit=v!!,imageLimit=i!!)
        }
        if(action=="arm"&&(!canArmSelected||!consent||planDraft&&!softConsent))return
        val planLimit=planLimitText.toIntOrNull()
        if(action=="arm"&&planDraft&&(planLimit==null||planLimit !in 1..2147483646)){error="请填写 1–2147483646 的套餐请求次数上限。";return}
        val daily=cfg.dailyTime.trim();val qs=quietStart.trim();val qe=quietEnd.trim()
        if(action!="disarm"){
            val clock=Regex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
            if(!clock.matches(daily)){error="每日固定时间请填写 HH:mm（00:00–23:59）。";return}
            if(quiet&&(!clock.matches(qs)||!clock.matches(qe))){error="安静时段请填写 HH:mm。";return}
            if(runCatching{ZoneId.of(cfg.timeZone.trim())}.isFailure){error="时区无效，请填写 IANA 时区。";return}
        }
        val request=DreamSettingsRequest(cid,response.settings.revision,action,
            e?.let{cfg.copy(timeZone=cfg.timeZone.trim(),dailyTime=daily,quietHours=if(quiet)DreamQuietHours(qs,qe)else null,execution=it)},model,consent,softConsent,planLimit?:5)
        busy=true;error="";notice=""
        scope.launch{
            try{
                val saved=api.saveDreamSettings(request)
                if(!saved.ok)error="保存未确认。"
                else{
                    hydrate(api.dreamSettings(cid))
                    notice=when(action){"arm"->"已授权自主唤醒";"disarm"->"已撤回授权";else->"设置已保存 · 未启用"}
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"保存未完成。"}
            finally{busy=false}
        }
    }
    ModalBottomSheet(onDismissRequest=onDismiss,sheetState=sheetState){
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal=16.dp).padding(bottom=28.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text("自主唤醒",style=MaterialTheme.typography.titleLarge)
            Text("仅本窗口 · 独立于普通聊天",style=MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                listOf("唤醒设置","自主手记","活动记录").forEachIndexed{i,label->
                    FilterChip(selected=tab==i,onClick={if(!busy){tab=i;offset=0;notice=""}},label={Text(label)},modifier=Modifier.weight(1f))
                }
            }
            if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
            if(notice.isNotBlank())Text(notice,style=MaterialTheme.typography.bodySmall)
            if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
            if(tab==0&&localMode) DreamNotificationControls(cid)
            if(tab==0&&loaded){
                Text(when{
                    !response.settings.enabled->"未授权"
                    response.settings.running->"活动中"
                    response.settings.modelId?.startsWith("chatgpt-plan:")==true&&!response.planExecutionAvailable->"已保存 · 本构建不执行"
                    response.settings.modelId?.startsWith("chatgpt-plan:")==true&&response.planStatus!="authorized"->"套餐活动暂停或待重新授权"
                    else->"已授权"
                })
                Text(if(localMode)if(canArm)"本机按系统后台调度尝试唤醒。仅向绑定供应商请求；强停、关机、断网或省电限制可能延迟或中断。" else "本机目前仅支持保存配置，尚未开放自动执行。不会访问云端。" else if(canArm)"服务端已配置调度，授权后才会请求模型。" else "服务端尚未开通调度，可先保存设置。",style=MaterialTheme.typography.bodySmall)
                response.settings.extraAt?.let{Text("下一次额外预约："+stamp(it))}
                if(response.settings.enabled)Button(onClick={save("disarm")},enabled=!busy){Text("关闭唤醒授权")}
                DreamField("绑定模型 ID",model,{model=it.take(180)},!busy)
                if(planDraft){
                    Text(if(canArmSelected)"套餐调用使用当前本机账号的共享额度。没有供应商强制输出 token 上限；额度不足会暂停已授权窗口，须明确重新授权。" else "套餐模型：当前构建仅保存草稿，不启用后台调用。",style=MaterialTheme.typography.bodySmall)
                    response.planStatus?.let{Text(when(it){"paused"->"套餐活动已暂停，请检查额度并重新授权。";"account_disconnected"->"套餐账号未连接或需重新授权。";"authorization_changed"->"账号或窗口授权已改变。";"authorized"->"套餐独立授权有效";else->"尚无套餐独立授权"},style=MaterialTheme.typography.bodySmall)}
                    val uri=androidx.compose.ui.platform.LocalUriHandler.current
                    TextButton(onClick={uri.openUri(com.elementeracoast.app.feature.chatgpt.NativeDreamPlanProtocol.USAGE_URL)}){Text("查看 ChatGPT 使用额度")}
                    DreamField("套餐单次请求次数上限（1–2147483646）",planLimitText,{planLimitText=it},!busy)
                }
                DreamField("时区（IANA）",cfg.timeZone,{cfg=cfg.copy(timeZone=it)},!busy)
                DreamField("每日固定时间（HH:mm）",cfg.dailyTime,{cfg=cfg.copy(dailyTime=it)},!busy)
                DreamSwitch("安静时段",quiet,!busy){quiet=it}
                if(quiet){
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        DreamField("开始",quietStart,{quietStart=it},!busy,Modifier.weight(1f))
                        DreamField("结束",quietEnd,{quietEnd=it},!busy,Modifier.weight(1f))
                    }
                }
                DreamSwitch("允许模型自主预约额外唤醒",cfg.allowExtra,!busy){cfg=cfg.copy(allowExtra=it)}
                DreamField("每日额外次数上限",extraText,{extraText=it},!busy)
                Text("独立预算与邀请",style=MaterialTheme.typography.titleMedium)
                Text("预算可自行填写；整数范围 1–2147483646，次数允许 0 表示禁止相应操作。实际输出受累计剩余预算、供应商能力与上下文约束；套餐输出为建议值。单次读取正文最多 60000 字符，过大请分页。",style=MaterialTheme.typography.bodySmall)
                DreamField("单次累计 token 预算",tokenText,{tokenText=it},!busy)
                DreamField(if(planDraft)"每次请求建议输出（软限制）" else "每次请求输出上限",outputText,{outputText=it},!busy)
                DreamField("单次工具调用上限",toolsText,{toolsText=it},!busy)
                DreamField("每次阅读最大轮数",readText,{readText=it},!busy)
                DreamField("每次活动语音尝试上限",voiceLimitText,{voiceLimitText=it},!busy)
                DreamField("每次活动生图尝试上限",imageLimitText,{imageLimitText=it},!busy)
                OutlinedTextField(execution.invitation,{execution=execution.copy(invitation=it)},label={Text("唤醒邀请词（最多16000字符）")},isError=execution.invitation.length>16000,modifier=Modifier.fillMaxWidth(),minLines=4,enabled=!busy)
                Text("可以什么也不做。输入 token 为估算，实际费用以供应商为准。",style=MaterialTheme.typography.bodySmall)
                DreamSwitch("当前时间",execution.includeTime,!busy){execution=execution.copy(includeTime=it)}
                DreamSwitch("上次活动与间隔",execution.includePrevious,!busy){execution=execution.copy(includePrevious=it)}
                DreamSwitch("自主手记与回复",execution.includeReplies,!busy){execution=execution.copy(includeReplies=it)}
                DreamSwitch("允许自主选读窗口历史",execution.readHistory,!busy){execution=execution.copy(readHistory=it)}
                DreamSwitch("允许写自主手记",execution.writeNote,!busy){execution=execution.copy(writeNote=it)}
                DreamSwitch("核心自定义",execution.includeCustom,!busy){execution=execution.copy(includeCustom=it)}
                DreamSwitch("用户画像",execution.includeUserPortrait,!busy){execution=execution.copy(includeUserPortrait=it)}
                DreamSwitch("自我画像",execution.includeSelfPortrait,!busy){execution=execution.copy(includeSelfPortrait=it)}
                DreamSwitch("期间新增对话轮数",execution.includeConversationCount,!busy){execution=execution.copy(includeConversationCount=it)}
                DreamSwitch("天气（需窗口现实权限）",execution.includeWeather,!busy){execution=execution.copy(includeWeather=it)}
                DreamSwitch("未来日历（需窗口现实权限）",execution.includeCalendar,!busy){execution=execution.copy(includeCalendar=it)}
                DreamSwitch("步数（仅本机且已授权）",execution.includeSteps,!busy){execution=execution.copy(includeSteps=it)}
                DreamSwitch("应用使用情况（仅本机且已授权）",execution.includeAppUsage,!busy){execution=execution.copy(includeAppUsage=it)}
                Text("通用工具（同时遵循现有窗口权限）",style=MaterialTheme.typography.titleMedium)
                DreamSwitch("独立联网",execution.allowWeb,!busy){execution=execution.copy(allowWeb=it)}
                DreamSwitch("书房阅读",execution.allowLibrary,!busy){execution=execution.copy(allowLibrary=it)}
                DreamSwitch("按需检索正式记忆",execution.allowMemory,!busy){execution=execution.copy(allowMemory=it)}
                DreamSwitch("提议记忆候选（仅待确认）",execution.allowMemoryCandidate,!busy){execution=execution.copy(allowMemoryCandidate=it)}
                DreamSwitch("查阅日历",execution.allowCalendar,!busy){execution=execution.copy(allowCalendar=it)}
                DreamSwitch("查阅收藏",execution.allowCollection,!busy){execution=execution.copy(allowCollection=it)}
                DreamSwitch("创建自己的书房笔记",execution.allowLibraryWrite,!busy){execution=execution.copy(allowLibraryWrite=it)}
                DreamSwitch("新增自己的日记与动态",execution.allowDailyWrite,!busy){execution=execution.copy(allowDailyWrite=it)}
                DreamSwitch("新增日历事项",execution.allowCalendarWrite,!busy){execution=execution.copy(allowCalendarWrite=it)}
                DreamSwitch("自主语音（独立供应商费用）",execution.allowVoice,!busy){execution=execution.copy(allowVoice=it)}
                DreamSwitch("自主生图（独立供应商费用）",execution.allowImage,!busy){execution=execution.copy(allowImage=it)}
                DreamSwitch("允许将本次自主生图原件转交支持视觉的模型（计入推理预算）",execution.allowImageReadback,!busy){execution=execution.copy(allowImageReadback=it)}
                Button(onClick={save("save")},enabled=!busy,modifier=Modifier.fillMaxWidth()){Text("保存设置（不启用）")}
                if(canArmSelected){
                    DreamSwitch(if(planDraft)"确认允许按设置自动使用本机套餐额度（媒体可能另计费用）" else "确认按上述设置进行模型调用并产生相应费用",consent,!busy){consent=it}
                    if(planDraft)DreamSwitch("理解套餐 token 为软预算，不是供应商硬上限",softConsent,!busy){softConsent=it}
                    Button(onClick={save("arm")},enabled=!busy&&consent&&(!planDraft||softConsent),modifier=Modifier.fillMaxWidth()){Text("保存并授权唤醒")}
                }
            }else if(tab==1){
                if(localMode&&!canArm)Text("本机自动执行尚未开放；已归档的历史仍可阅读。",style=MaterialTheme.typography.bodySmall)
                if(notePage.items.isEmpty()&&!busy)Text("还没有自主手记。")
                Text("回复只保存文字，不立即唤醒模型。",style=MaterialTheme.typography.bodySmall)
                notePage.items.forEach{note->key(cid,note.claimId){
                    var body by remember{mutableStateOf("")}
                    var retryId by remember{mutableStateOf("")}
                    var retryBody by remember{mutableStateOf("")}
                    com.elementeracoast.app.ui.theme.SnowLetterSurface(modifier=Modifier.fillMaxWidth(),role=com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole.StatusCard,fallbackColor=MaterialTheme.colorScheme.surface,fallbackBorder=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant.copy(alpha=.55f)),fallbackElevation=1.dp){
                        Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                            Text(stamp(note.createdAt)+" · "+note.modelId,style=MaterialTheme.typography.bodySmall)
                            Text(note.body)
                            note.replies.forEach{reply->Text(stamp(reply.createdAt)+" · 回复\n"+reply.body,style=MaterialTheme.typography.bodySmall)}
                            OutlinedTextField(body,{body=it.take(16000)},label={Text("回复")},modifier=Modifier.fillMaxWidth(),enabled=!busy,minLines=2)
                            Button(enabled=!busy&&body.isNotBlank(),onClick={
                                if(retryBody!=body){retryBody=body;retryId=UUID.randomUUID().toString()}
                                val text=body;val id=retryId
                                busy=true;error=""
                                scope.launch{
                                    try{api.replyDreamNote(cid,note.claimId,id,text);body="";retryBody="";retryId="";notePage=api.dreamNotes(cid,offset)}
                                    catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"回复保存未确认。"}
                                    finally{busy=false}
                                }
                            }){Text("保存回复")}
                        }
                    }
                }}
            }else if(tab==2){
                if(localMode&&!canArm)Text("本机自动执行尚未开放；已归档的历史仍可阅读。",style=MaterialTheme.typography.bodySmall)
                if(activityPage.items.isEmpty()&&!busy)Text("还没有活动记录。")
                activityPage.items.forEach{r->com.elementeracoast.app.ui.theme.SnowLetterSurface(modifier=Modifier.fillMaxWidth(),role=com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole.StatusCard,fallbackColor=MaterialTheme.colorScheme.surface,fallbackBorder=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant.copy(alpha=.55f)),fallbackElevation=1.dp){
                    Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                        Text(stamp(r.startedAt)+" · "+if(r.kind=="daily")"固定唤醒" else "额外唤醒")
                        Text(status(r.status)+" · "+r.modelId,style=MaterialTheme.typography.bodySmall)
                        r.result.field("reason")?.let{reason->Text("活动回执："+when(reason){"ended"->"正常结束";"budget_or_usage_unknown"->"预算已用尽或供应商未返回用量";"plan_step_or_soft_budget_limit"->"套餐请求次数或软预算达到上限";"plan_soft_budget_exhausted"->"套餐软预算已用尽";"execution_failed"->"执行异常";"process_interrupted"->"进程中断";"cancelled"->"已取消";else->reason},style=MaterialTheme.typography.bodySmall)}
                        Text("总 token："+(r.result.field("total_tokens")?:"未确认")+" · 成本："+(r.result.field("reported_cost")?.let{"USD "+it}?:"未确认"),style=MaterialTheme.typography.bodySmall)
                        r.tools.forEach{t->
                            val name=t.field("tool_name").orEmpty()
                            Text(toolName(name)+" · "+status(t.field("status").orEmpty()),style=MaterialTheme.typography.bodySmall)
                            val id=(t as? JsonObject)?.get("receipt").field("record_id")
                            val suffix=r.claimId+"_"+t.field("step_index")+"_"+t.field("call_index")
                            if(id!=null&&((name=="voice_create"&&id=="voice_dream_"+suffix)||(name=="image_generate"&&id=="att_dream_"+suffix)))TextButton(onClick={previewId=id}){Text(if(name=="voice_create")"查看原声" else "查看原图")}
                        }
                        if(r.result.field("extra_scheduled")=="true")Text("已保存额外预约。",style=MaterialTheme.typography.bodySmall)
                        r.steps.forEach{s->
                            val receipt=(s as? JsonObject)?.get("receipt") as? JsonObject
                            val accepted=receipt?.get("image_readback_accepted") as? JsonArray
                            val uncertain=receipt?.get("image_readback_unconfirmed") as? JsonArray
                            if(accepted!=null)Text("图像回读请求已获得响应 · "+accepted.size+" 张",style=MaterialTheme.typography.bodySmall)
                            if(uncertain!=null)Text("图像回读请求结果未确认 · "+uncertain.size+" 张",style=MaterialTheme.typography.bodySmall)
                        }
                        if(r.steps.any{it.field("status")=="claimed"})Text("存在未确认请求，不会自动重放。",style=MaterialTheme.typography.bodySmall)
                    }
                }}
            }
            if(tab!=0){
                val next=if(tab==1)notePage.nextOffset else activityPage.nextOffset
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    if(offset>0)OutlinedButton(onClick={offset=(offset-20).coerceAtLeast(0)},enabled=!busy){Text("上一页")}
                    if(next!=null)OutlinedButton(onClick={offset=next},enabled=!busy){Text("下一页")}
                }
            }
            OutlinedButton(onClick={scope.launch{load()}},enabled=!busy){Text("刷新")}
            Button(onClick=onDismiss,modifier=Modifier.fillMaxWidth()){Text("返回窗口设置")}
        }
    }
}
@Composable
private fun DreamField(label:String,value:String,change:(String)->Unit,enabled:Boolean,modifier:Modifier=Modifier.fillMaxWidth()){
    OutlinedTextField(value,change,label={Text(label)},modifier=modifier,singleLine=true,enabled=enabled)
}
@Composable
private fun DreamSwitch(label:String,checked:Boolean,enabled:Boolean,change:(Boolean)->Unit){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Text(label,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
        Switch(checked=checked,onCheckedChange=change,enabled=enabled)
    }
}

@Composable
private fun DreamMediaPreview(api:CoastApiClient,cid:String,id:String,onDismiss:()->Unit){
    var error by remember(id){mutableStateOf("")}
    var bitmap by remember(id){mutableStateOf<android.graphics.Bitmap?>(null)}
    val audio=id.startsWith("voice_dream_")
    LaunchedEffect(cid,id){
        if(!audio)try{
            val bytes=api.dreamMediaBytes(cid,id)
            bitmap=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default){
                val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
                android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                require(bounds.outWidth>0&&bounds.outHeight>0){"图像原件无法解码。"}
                var sample=1
                while(maxOf(bounds.outWidth,bounds.outHeight)/sample>2048)sample*=2
                android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,android.graphics.BitmapFactory.Options().apply{inSampleSize=sample})
                    ?:throw IllegalArgumentException("图像原件无法解码。")
            }
        }catch(c:CancellationException){throw c}catch(e:Exception){error=e.message?:"原件已删除或暂不可访问。"}
    }
    AlertDialog(onDismissRequest=onDismiss,title={Text(if(audio)"自主活动语音" else "自主活动图像")},text={
        Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
            if(audio)com.elementeracoast.app.feature.daily.CoastMediaAudio(id,{api.dreamMediaBytes(cid,id)},{error=it})
            else if(bitmap!=null)androidx.compose.foundation.Image(
                bitmap=bitmap!!.asImageBitmap(),contentDescription="自主活动原图预览",
                modifier=Modifier.fillMaxWidth().heightIn(max=420.dp),contentScale=androidx.compose.ui.layout.ContentScale.Fit)
            else if(error.isBlank())Text("正在读取原件……")
            if(error.isNotBlank())Text(error,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
        }
    },confirmButton={TextButton(onClick=onDismiss){Text("关闭")}})
}
