package com.elementeracoast.app.feature.wolf

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.local.*
import com.elementeracoast.app.core.remote.RemoteChatMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
internal fun LocalProviderPanel(current: String, onRefresh: () -> Unit, onSelect: (String) -> Unit) {
    val context = LocalContext.current.applicationContext
    val store = remember(context) { LocalProviderStore(context) }
    val client = remember { LocalProviderClient() }
    val scope = rememberCoroutineScope()
    var providers by remember { mutableStateOf<List<LocalProviderConfig>>(emptyList()) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var editId by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var manual by remember { mutableStateOf("") }
    var remove by remember { mutableStateOf<LocalProviderConfig?>(null) }
    var expanded by remember { mutableStateOf<String?>(null) }

    fun run(block: suspend () -> String) {
        if (busy) return
        busy = true
        scope.launch {
            try { message = block() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { message = if (e is com.elementeracoast.app.core.network.CoastApiException) e.message else "操作失败，请检查输入或本机凭据存储。" }
            finally { busy = false }
        }
    }
    suspend fun reload() { providers = withContext(Dispatchers.IO) { store.load() }; onRefresh() }
    LaunchedEffect(store) {
        try { providers = withContext(Dispatchers.IO) { store.load() } }
        catch (_: Exception) { message = "本机凭据无法读取；未覆盖原资料。" }
    }
    fun edit(value: LocalProviderConfig? = null) {
        editId = value?.id ?: UUID.randomUUID().toString()
        name = value?.name ?: "OpenRouter"
        url = value?.baseUrl ?: "https://openrouter.ai/api/v1"
        key = ""
        manual = value?.models?.joinToString("\n").orEmpty()
        editing = true
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("本机 API 供应商", style = MaterialTheme.typography.titleMedium)
        Text("支持 HTTPS OpenAI 兼容 Chat Completions。Key 加密留在本机，聊天只发送给选中的模型服务。当前仅支持近期文字上下文；记忆、工具、附件与自动整理待接入。",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        providers.forEach { p ->
            Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .6f)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(p.name, style = MaterialTheme.typography.titleSmall)
                    Text(p.baseUrl, style = MaterialTheme.typography.bodySmall)
                    Text("Key 已加密保存 · " + p.models.size + " 个模型", style = MaterialTheme.typography.bodySmall)
                    Row {
                        TextButton(enabled = !busy, onClick = { edit(p) }) { Text("编辑") }
                        TextButton(enabled = !busy, onClick = { run {
                            val found = client.models(p)
                            if (found.isEmpty()) "连接成功，但供应商没有返回模型。"
                            else { withContext(Dispatchers.IO) { store.upsert(p.copy(models = (p.models + found).distinct())) }; reload(); "目录已读取：" + found.size + " 个模型。" }
                        } }) { Text("获取模型") }
                        TextButton(enabled = !busy, onClick = { run { client.balance(p) } }) { Text("额度") }
                    }
                    Row {
                        TextButton(enabled = !busy && p.models.isNotEmpty(), onClick = { run {
                            val selected = p.models.firstOrNull { p.modelId(it) == current } ?: p.models.first()
                            var reply = ""
                            client.stream(p, selected, listOf(RemoteChatMessage("user", "Reply with OK.")), 128).collect { e ->
                                if (e is LocalProviderEvent.Delta) reply += e.text
                            }
                            if (reply.isBlank()) "连接成功但没有文字回复。" else "真实回复测试成功（可能消耗额度；未写入聊天）。"
                        } }) { Text("测试回复") }
                        TextButton(enabled = !busy, onClick = { expanded = if (expanded == p.id) null else p.id }) { Text("模型列表") }
                        TextButton(enabled = !busy, onClick = { remove = p }) { Text("移除") }
                    }
                    if (expanded == p.id) {
                        p.models.take(100).forEach { model ->
                            TextButton(enabled = !busy, onClick = { onSelect(p.modelId(model)) }) {
                                Text((if (current == p.modelId(model)) "当前 · " else "") + model)
                            }
                        }
                        if (p.models.size > 100) Text("其余模型可从聊天顶部搜索选择。", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        OutlinedButton(enabled = !busy, onClick = { edit() }, modifier = Modifier.fillMaxWidth()) { Text("添加供应商") }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodySmall)
    }
    if (editing) AlertDialog(
        onDismissRequest = { editing = false; key = "" },
        title = { Text("本机供应商") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("名称") }, singleLine = true)
                OutlinedTextField(url, { url = it }, label = { Text("API Base URL") }, singleLine = true)
                OutlinedTextField(key, { key = it }, label = { Text("API Key（编辑时可留空保留）") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation())
                OutlinedTextField(manual, { manual = it }, label = { Text("模型 ID · 每行一个，可稍后获取") }, maxLines = 4)
                Text("只允许 HTTPS。更改服务地址必须重新输入 Key；不会将旧 Key 自动发送给新地址。", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            val previous = providers.firstOrNull { it.id == editId }
            val normalized = runCatching { normalizeLocalProviderUrl(url) }.getOrNull()
            val entered = key.trim()
            val effective = entered.ifBlank { if (normalized == previous?.baseUrl) previous?.apiKey.orEmpty() else "" }
            if (normalized == null || effective.isBlank() || name.isBlank()) { message = "请填写有效 HTTPS URL、名称及 Key。"; return@TextButton }
            val value = LocalProviderConfig(editId, name.trim(), normalized, effective, manual.lines())
            editing = false; key = ""
            run { withContext(Dispatchers.IO) { store.upsert(value) }; reload(); "供应商已加密保存。" }
        }) { Text("保存") } },
        dismissButton = { TextButton(onClick = { editing = false; key = "" }) { Text("取消") } }
    )
    remove?.let { p -> AlertDialog(
        onDismissRequest = { remove = null }, title = { Text("移除供应商？") },
        text = { Text("仅移除该本机供应商配置，不删除历史聊天。") },
        confirmButton = { TextButton(onClick = { remove = null; run { withContext(Dispatchers.IO) { store.remove(p.id) }; reload(); "已移除。" } }) { Text("移除") } },
        dismissButton = { TextButton(onClick = { remove = null }) { Text("取消") } }
    ) }
}
