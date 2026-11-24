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
import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.MainActivity
import com.elementeracoast.app.core.local.CoastTransferCodec
import com.elementeracoast.app.core.local.LocalTransferRestore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.io.ByteArrayOutputStream
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

private val labels = mapOf("chat" to "聊天窗口", "calendar" to "日历与纪念日", "daily" to "日记与动态",
    "model_profile" to "模型资料", "daily_profile" to "日常资料", "moments" to "动态", "diaries" to "日记")

@Composable
internal fun TransferPanel(archive: GlobalArchiveRepository, localMode: Boolean, operationsAllowed: Boolean, onSnackbar: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val destination = if (localMode) "本机" else "当前云端"
    var busy by remember { mutableStateOf(false) }
    var pendingExport by remember { mutableStateOf<ByteArray?>(null) }
    var payload by remember { mutableStateOf<JsonObject?>(null) }
    var allowed by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var preview by remember { mutableStateOf<JsonObject?>(null) }
    var result by remember { mutableStateOf<JsonObject?>(null) }
    var selectedBundle by remember { mutableStateOf<JsonObject?>(null) }
    var failure by remember { mutableStateOf("") }

    fun clear() {
        payload = null; preview = null; result = null; selectedBundle = null; failure = ""; selected = emptySet(); allowed = emptySet()
    }

    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val bytes = pendingExport
        pendingExport = null
        if (uri == null || bytes == null) { busy = false; return@rememberLauncherForActivityResult }
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("无法写入文件。")
                }
                onSnackbar("可迁移数据包已导出，请妥善保存。")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { onSnackbar("导出失败：${e.message}") }
            finally { busy = false }
        }
    }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) { busy = false; return@rememberLauncherForActivityResult }
        scope.launch {
            try {
                val decoded = withContext(Dispatchers.IO) {
                    val raw = context.contentResolver.openInputStream(uri)?.use { input ->
                        val out = ByteArrayOutputStream()
                        val buffer = ByteArray(65536)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            require(out.size().toLong() + n <= CoastTransferCodec.MAX_BYTES) { "数据包超过 64 MiB。" }
                            out.write(buffer,0,n)
                        }
                        out.toByteArray()
                    } ?: error("无法读取文件。")
                    CoastTransferCodec.decode(raw)
                }
                val declared = decoded.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }.toSet()
                allowed = if (localMode) LocalTransferRestore.availableModules(decoded, BuildConfig.APPLICATION_ID)
                    else declared.intersect(setOf("chat", "calendar"))
                selected = allowed
                payload = decoded
                failure = ""
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { onSnackbar("无法打开数据包：格式、大小或完整性校验未通过。旧 JSON / HTML 尚不能直接恢复。") }
            finally { busy = false }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        WolfRow("导出可迁移数据包", if (localMode) "本机聊天、日历、日常与模型资料 · 不含凭据" else "云端聊天及日历 · 不含媒体原件与凭据") {
            if (busy || !operationsAllowed) { onSnackbar("请等待当前操作完成。"); return@WolfRow }
            busy = true
            scope.launch {
                try {
                    val bundle = archive.transferExport()
                    val bytes = withContext(Dispatchers.Default) {
                        bundle.toString().encodeToByteArray().also { CoastTransferCodec.decode(it) }
                    }
                    pendingExport = bytes
                    val stamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(LocalDateTime.now())
                    save.launch("elementera-transfer-$stamp.coastpack.json")
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (e: Exception) { busy = false; onSnackbar("导出失败：${e.message}") }
            }
        }
        WolfRow("导入可迁移数据包", "校验与预览后写入$destination · 已存在记录不覆盖") {
            if (busy || !operationsAllowed) { onSnackbar("请等待当前操作完成。"); return@WolfRow }
            clear(); busy = true; open.launch(arrayOf("application/json","text/plain","application/octet-stream"))
        }
        Text("单文件最多 64 MiB；云端单次导入最多 8 MiB、90 条原子写入。附件、语音、长期记忆等暂不恢复；凭据需重新配置。原 JSON / HTML 仍可用于阅读和防丢。",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    val raw = payload ?: return
    val declared = raw.getValue("includedModules").jsonArray.map { it.jsonPrimitive.content }.toSet()
    val shown = result ?: preview
    AlertDialog(
        onDismissRequest = { if (!busy && result == null) clear() },
        title = { Text(if (result != null) "已确认导入" else "迁移至$destination") },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("来源：${if (raw["workspace"]?.jsonPrimitive?.content == "local") "本机" else "在线海岸"}。目标已有资料不会被覆盖。")
                declared.forEach { module ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = module in selected, enabled = !busy && preview == null && module in allowed,
                            onCheckedChange = { checked -> selected = if (checked) selected + module else selected - module })
                        Text((labels[module] ?: module) + if (module !in allowed) " · 目标暂不支持" else "")
                    }
                }
                if (shown != null) {
                    shown.forEach { (key,value) ->
                        val row = value as? JsonObject ?: return@forEach
                        val ready = row["ready"]?.jsonPrimitive?.intOrNull ?: return@forEach
                        val existing = row["existing"]?.jsonPrimitive?.intOrNull ?: 0
                        val conflicts = row["conflicts"]?.jsonPrimitive?.intOrNull
                        Text("${labels[key] ?: key}：${if (result == null) "可新增" else "已导入"} $ready · 已存在保留 $existing" +
                            (conflicts?.let { " · 冲突 $it" } ?: ""))
                        (row["blocked"] as? JsonArray)?.forEach { item ->
                            val blocked = item as? JsonObject
                            Text(blocked?.get("reason")?.jsonPrimitive?.contentOrNull ?: "存在不兼容记录", color = MaterialTheme.colorScheme.error)
                        }
                    }
                    if (shown["can_commit"]?.jsonPrimitive?.booleanOrNull == false) Text("存在不兼容记录或写入超限，本次不会导入。", color = MaterialTheme.colorScheme.error)
                    if (result != null) Text("重新打开海岸以刷新窗口与资料。原文件请保留。")
                } else if (!localMode) Text("预览也会将所选模块上传至你已登录的后端；未选模块不会发送。确认导入前不会写入记录。")
                if (failure.isNotBlank()) Text(failure, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && (result != null || operationsAllowed && selected.isNotEmpty() &&
                preview?.get("can_commit")?.jsonPrimitive?.booleanOrNull != false), onClick = {
                if (result != null) {
                    context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                    clear()
                } else {
                    busy = true; failure = ""
                    scope.launch {
                        try {
                            if (preview == null) {
                                val bundle = withContext(Dispatchers.Default) {
                                    val bytes = CoastTransferCodec.select(raw, selected)
                                    require(localMode || bytes.size <= CoastTransferCodec.CLOUD_REQUEST_MAX_BYTES) { "选中数据超过云端 8 MiB 上限。" }
                                    Json.parseToJsonElement(bytes.decodeToString()).jsonObject
                                }
                                preview = archive.transferPreview(bundle, selected)
                                selectedBundle = bundle
                            } else {
                                result = archive.transferImport(requireNotNull(selectedBundle), selected)
                            }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (e: Exception) { failure = e.message ?: "迁移失败，未确认写入。" }
                        finally { busy = false }
                    }
                }
            }) { Text(if (busy) "处理中…" else if (result != null) "重新打开海岸" else if (preview != null) "确认导入" else if (localMode) "预览" else "上传所选并预览") }
        },
        dismissButton = {
            if (result == null) {
                TextButton(enabled = !busy, onClick = {
                    if (preview != null) { preview = null; selectedBundle = null; failure = "" } else clear()
                }) { Text(if (preview != null) "返回选择" else "取消") }
            }
        }
    )
}
