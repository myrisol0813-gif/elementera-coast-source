package com.elementeracoast.app.feature.wolf

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.MainActivity
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

private val v2Labels=mapOf("chat" to "聊天","calendar" to "日历","daily" to "日常","model_profile" to "模型资料","attachments" to "附件","voice" to "语音","thinking_soil" to "思维壤","thinking_soil_history" to "思维壤历史","dogtalk_records" to "私人草稿","dogtalk_snapshots" to "历史快照","memory_entries" to "记忆","memory_pockets" to "候选","user_portrait" to "用户画像","self_portrait" to "自我画像","worldbook" to "世界书","custom_instructions" to "自定义","vault" to "拾潮","library" to "书房","appearance" to "外观","tools" to "工具")
@Composable
internal fun ArchiveV2Panel(operations:ArchiveV2Operations,archive:GlobalArchiveRepository,localMode:Boolean,allowed:Boolean,onSnackbar:(String)->Unit,htmlBusy:Boolean,onExportHtml:()->Unit){
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var legacyUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var status by remember { mutableStateOf("") }
    var pendingFile by remember { mutableStateOf<File?>(null) }
    var incoming by remember { mutableStateOf<ArchiveV2Operations.Imported?>(null) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var choices by remember { mutableStateOf<List<ArchiveV2Operations.Choice>>(emptyList()) }
    var chosen by remember { mutableStateOf<ArchiveV2Operations.Choice?>(null) }
    var session by remember { mutableStateOf<String?>(null) }
    var uploaded by remember { mutableStateOf(false) }
    var stagedChoice by remember { mutableStateOf<ArchiveV2Operations.Choice?>(null) }
    var preview by remember { mutableStateOf<JsonObject?>(null) }
    var committed by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")){uri->
        val file=pendingFile;pendingFile=null
        if(file==null){busy=false;return@rememberLauncherForActivityResult}
        scope.launch{
            try{
                if(uri!=null){
                    withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use { out->file.inputStream().use { it.copyTo(out) } }?:error("无法写入文件。")}
                    onSnackbar("V2 ZIP 已导出；归档覆盖范围详见清单。")
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){onSnackbar("导出未完成。")}
            finally{file.parentFile?.deleteRecursively();busy=false}
        }
    }
    val open=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->
        if(uri==null){busy=false;return@rememberLauncherForActivityResult}
        scope.launch{
            try{
                val isZip=withContext(Dispatchers.IO){
                    val header=context.contentResolver.openInputStream(uri)?.use { ByteArray(4).let { bytes -> var at=0; while(at<bytes.size){val n=it.read(bytes,at,bytes.size-at);if(n<0)break;at+=n};bytes.copyOf(at) } }?:error("无法读取归档")
                    header.contentEquals(byteArrayOf(0x50,0x4b,0x03,0x04))
                }
                if(!isZip){legacyUri=uri;return@launch}
                val input=operations.open(uri)
                choices=operations.cloudChoices(input);chosen=choices.firstOrNull()
                incoming=input;selected=operations.localModules(input.manifest)
                session=null;stagedChoice=null;uploaded=false;preview=null;committed=false;failure=""
            }catch(e:CancellationException){throw e}catch(e:Exception){onSnackbar("无法读取 V2 ZIP：格式、空间或完整性校验失败。")}
            finally{busy=false}
        }
    }
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        WolfRow("导出","海岸归档 ZIP · 原件与清单"){
            if(!allowed||busy||legacyUri!=null||incoming!=null)return@WolfRow
            busy=true;status="准备归档"
            scope.launch{
                try{
                    val (file,manifest)=operations.export{n,b->scope.launch { status="已采集 $n 项 · $b 字节" }}
                    pendingFile=file
                    status="已采集 "+manifest.records.size+" 项"
                    save.launch("elementera-coast-v2-"+DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(LocalDateTime.now())+".zip")
                }catch(e:CancellationException){throw e}catch(e:Exception){busy=false;onSnackbar("V2 导出未完成；原资料未修改。")}
            }
        }
        WolfRow("导出 HTML",if(htmlBusy)"正在导出…" else "离线阅读 ZIP · 解压后打开 index.html"){
            if(!busy&&legacyUri==null&&incoming==null&&!htmlBusy)onExportHtml()
        }
        WolfRow("导入","自动识别 ZIP / 旧版迁移 JSON · 先预览再确认"){
            if(!allowed||busy||incoming!=null||legacyUri!=null)return@WolfRow
            busy=true;open.launch(arrayOf("application/zip","application/json","text/plain","application/octet-stream"))
        }
        if(busy)Text(status.ifBlank { "处理中…" },style=MaterialTheme.typography.bodySmall)
        Text("归档范围以清单为准；尚未接通的模块不会恢复。HTML 仅用于阅读。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    legacyUri?.let { uri -> TransferPanel(archive,localMode,allowed,onSnackbar,uri){legacyUri=null} }
    val input=incoming?:return
    val available=operations.localModules(input.manifest)
    fun dismiss(){
        busy=true
        scope.launch {
            try {
                session?.let { operations.cancelSession(it) }
                input.close();incoming=null;choices=emptyList();chosen=null;session=null;stagedChoice=null;preview=null;uploaded=false;failure=""
            }catch(e:CancellationException){throw e}catch(e:Exception){failure="暂存清理未完成，请重试。"}
            finally{busy=false}
        }
    }
    AlertDialog(
        onDismissRequest={if(!busy)dismiss()},
        title={Text(if(committed)"恢复完成" else "V2 归档预览")},
        text={
            Column(Modifier.heightIn(max=440.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(6.dp)){
                Text("来源："+input.manifest.workspace+" · "+input.manifest.records.size+" 项记录")
                input.manifest.modules.forEach { m->
                    val label=v2Labels[m.module]?:m.module
                    if(m.module in available) Row(verticalAlignment=Alignment.CenterVertically){
                        Checkbox(m.module in selected,enabled=!busy&&preview==null,onCheckedChange={selected=if(it)selected+m.module else selected-m.module});Text("$label · "+m.count)
                    } else Text("$label · "+m.count+" · "+if(m.coverage=="unavailable")"未采集" else if(m.module=="chat"&&choices.any { it.kind=="chat" })"可逐窗口恢复" else if(m.module=="library"&&choices.any { it.kind=="book" })"可逐本恢复" else if(choices.any { it.kind==m.module })"可逐项恢复" else "本次不恢复")
                }
                if(!localMode&&choices.isNotEmpty()) {
                    Text("选择一项资料：仅上传所选项目及其归档依赖。")
                    choices.forEach { item->Row(verticalAlignment=Alignment.CenterVertically){
                        RadioButton(chosen==item,enabled=!busy&&preview==null,onClick={chosen=item});Text((if(item.kind=="book")"书房" else v2Labels[item.kind]?:item.kind)+" · "+item.title)
                    }}
                }
                preview?.let { p->
                    Text(if(committed)"已确认写入；请重新打开海岸刷新资料及外观。" else "预检通过。只写入所选记录；外观为明确选择后的设置替换，其他记录不覆盖。")
                    if(localMode)p.forEach { (k,v)->if(v is JsonObject){
                        Text((v2Labels[k]?:k)+" · 新增 "+v["ready"]+" · 已有 "+v["existing"]+" · 冲突 "+v["conflicts"])
                        v["archived_only"]?.let{Text("其中 "+it+" 条旧快照仅保留历史原件，不重新关联消息或注入上下文。")}
                    } }
                    else if(p["scope"]?.jsonPrimitive?.contentOrNull=="daily_group")Text("评论 "+p["comments"]+" · 点赞 "+p["likes"])
                    else if(p["scope"]?.jsonPrimitive?.contentOrNull=="portrait_group")Text("候选 "+p["candidates"]+" · 历史 "+p["revisions"])
                    else if(p["scope"]?.jsonPrimitive?.contentOrNull=="record_only")Text("新增 "+p["ready"]+" · 已有 "+p["existing"])
                    else if(p["scope"]?.jsonPrimitive?.contentOrNull=="book_only")Text("章节 "+p["chapters"]+" · 批注 "+p["notes"])
                    else Text("聊天："+p["turns"]+" 轮 · 附件 "+p["attachments"]+" · 语音 "+p["voices"]+" · 思维壤 "+p["soils"]+" · 快照 "+p["snapshots"])
                }
                if(busy)Text(status.ifBlank { "处理中…" })
                if(failure.isNotBlank())Text(failure,color=MaterialTheme.colorScheme.error)
            }
        },
        confirmButton={
            TextButton(enabled=!busy&&(committed||allowed&&(if(localMode)selected.isNotEmpty() else chosen!=null)),onClick={
                if(committed){dismiss();return@TextButton}
                busy=true;failure=""
                scope.launch{
                    try{
                        val confirm=preview!=null
                        if(localMode)preview=operations.localRestore(input,selected,confirm)
                        else {
                            val choice=requireNotNull(chosen)
                            if(session!=null&&stagedChoice!=choice){
                                operations.cancelSession(requireNotNull(session))
                                session=null;stagedChoice=null;uploaded=false
                            }
                            val manifest=operations.cloudManifest(input,choice)
                            val sid=session?:operations.createSession().also { session=it;stagedChoice=choice }
                            if(!uploaded){
                                status="本次上传 "+manifest.records.size+" 项 · "+manifest.objects.sumOf { it.size }+" 字节"
                                val p=operations.upload(input,sid,choice){n->scope.launch { status="已上传 $n 个新分块 · 仅所选资料" }}
                                require(p["ready_for_byte_verification"]?.jsonPrimitive?.booleanOrNull==true)
                                uploaded=true
                            }
                            preview=operations.cloudRestore(input,sid,choice,confirm)
                        }
                        if(confirm)committed=true
                    }catch(e:CancellationException){throw e}catch(e:Exception){failure="操作未完成："+(e.message?.take(160)?:"资料校验或写入失败。")}
                    finally{busy=false}
                }
            }){Text(if(committed)"关闭并清理暂存" else if(preview!=null)"确认恢复" else if(localMode)"预览" else "上传并预览")}
        },
        dismissButton={if(committed&&!localMode)TextButton(enabled=!busy,onClick={choices=choices.filter { it!=chosen };chosen=choices.firstOrNull();committed=false;preview=null;failure=""}){Text("继续恢复其他资料")} else if(!committed)TextButton(enabled=!busy,onClick={if(preview!=null){preview=null;failure=""}else dismiss()}){Text(if(preview!=null)"返回选择" else "取消并清理")}}
    )
}
