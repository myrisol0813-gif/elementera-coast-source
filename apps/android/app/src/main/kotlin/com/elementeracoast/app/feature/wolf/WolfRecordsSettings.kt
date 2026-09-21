package com.elementeracoast.app.feature.wolf

import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

@Composable
internal fun ChatRecordsScreen(
    profile: WolfProfile,
    messages: List<ChatMessage>,
    archive: GlobalArchiveRepository,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val stamp = remember { DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(LocalDateTime.now()) }
    var pendingText by remember { mutableStateOf("") }
    var pendingOk by remember { mutableStateOf("已导出") }
    var pendingSummary by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun write(uri: Uri?, text: String) {
        if (uri == null) {
            busy = false
            return
        }
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(text) }
                ?: error("无法打开目标文件")
        }
            .onSuccess {
                onActionLogged("chat.export", pendingOk, pendingSummary)
                onSnackbar(pendingOk)
            }
            .onFailure { onSnackbar("导出失败：${it.message ?: "无法写入文件"}") }
        busy = false
    }

    val jsonExport = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        write(uri, pendingText)
    }
    val htmlExport = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/html")) { uri ->
        write(uri, pendingText)
    }

    fun launchGlobal(format: String) {
        if (busy) return
        busy = true
        scope.launch {
            runCatching { archive.snapshot() }
                .onSuccess { snapshot ->
                    if (format == "html") {
                        pendingText = GlobalArchive.exportHtml(snapshot)
                        pendingOk = "已导出全局 HTML"
                        pendingSummary = "snapshot-backed · 不含附件二进制"
                        htmlExport.launch("elementera-coast-global-$stamp.html")
                    } else {
                        pendingText = GlobalArchive.exportJson(snapshot)
                        pendingOk = "已导出全局 JSON"
                        pendingSummary = "V1 全局快照 · 已脱敏"
                        jsonExport.launch("elementera-coast-global-$stamp.json")
                    }
                }
                .onFailure {
                    busy = false
                    onSnackbar("全局导出失败：${it.message ?: "无法读取后端快照"}")
                }
        }
    }

    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("防丢导出", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        item {
            WolfRow("全局 JSON", if (busy) "正在读取全局快照……" else "V1 全局快照 · 与 Web 同一数据源") {
                launchGlobal("json")
            }
        }
        item {
            WolfRow("全局 HTML", "同一全局快照的可读离线文档") {
                launchGlobal("html")
            }
        }
        item {
            WolfRow("当前窗口 JSON", "局部副本 · 保留当前显示消息与资料 metadata") {
                if (!busy) {
                    busy = true
                    pendingText = ChatArchive.exportJson(profile, messages)
                    pendingOk = "已导出当前窗口 JSON"
                    pendingSummary = "当前窗口 ${messages.size} 条消息"
                    jsonExport.launch("elementera-chat-$stamp.json")
                }
            }
        }
        item {
            WolfRow("导入当前窗口 JSON", "真实 history 写回本轮未接；暂不导入") {
                @Suppress("UNUSED_EXPRESSION")
                onImportMessages
                onSnackbar("聊天记录导入暂未接后端；没有修改当前真实会话。")
            }
        }
        item {
            Text(
                "全局 JSON 与全局 HTML 都直接读取 /api/export/v1-snapshot：聊天窗口、整理当前对话的纸条、记忆、全局摘录与修改记录、世界书、自定义指令、模型后端返回原文、工具摘要、附件索引、搜索摘要和版本信息共用一份来源。附件二进制不会塞进 HTML。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
internal fun BasicSettingsScreen(settings: BasicSettings, store: WolfStore, onSnackbar: (String) -> Unit) {
    var recentTurnsText by remember(settings.recentTurns) { mutableStateOf(settings.recentTurns.toString()) }
    var contextBudgetText by remember(settings.contextBudget) { mutableStateOf(settings.contextBudget.toString()) }

    fun commitRecentTurns() {
        val parsed = recentTurnsText.toIntOrNull()
        val value = if (parsed != null && parsed >= 1) parsed else 8
        recentTurnsText = value.toString()
        if (value == settings.recentTurns) return
        store.updateBasic { it.copy(recentTurns = value) }
        onSnackbar("当前设备最近聊天轮数已设为 $value")
    }

    fun commitContextBudget() {
        val parsed = contextBudgetText.toIntOrNull()
        val value = if (parsed != null && parsed >= 1800) parsed else 6000
        contextBudgetText = value.toString()
        if (value == settings.contextBudget) return
        store.updateBasic { it.copy(contextBudget = value) }
        onSnackbar("当前设备上下文 token budget 已设为 $value")
    }

    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("基本设置", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        item {
            SettingGroup("上下文舒服区间") {
                Text("最近聊天轮数", fontWeight = FontWeight.Medium)
                OutlinedTextField(
                    value = recentTurnsText,
                    onValueChange = { raw -> recentTurnsText = raw.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth().onFocusChanged { state ->
                        if (!state.isFocused) commitRecentTurns()
                    },
                    suffix = { Text("轮") },
                    supportingText = { Text("默认 8；常用可试 8 / 12 / 20。没有应用层上限，实际可递入量取决于当前窗口历史、token budget 与模型上下文窗口。") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { commitRecentTurns() })
                )
                Text("上下文 token budget", fontWeight = FontWeight.Medium)
                OutlinedTextField(
                    value = contextBudgetText,
                    onValueChange = { raw -> contextBudgetText = raw.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth().onFocusChanged { state ->
                        if (!state.isFocused) commitContextBudget()
                    },
                    suffix = { Text("tokens") },
                    supportingText = { Text("默认 6000；推荐从 6000 / 12000 / 20000 起调。最小 1800，不设应用层上限；最终仍受模型与 provider 的真实 context window 限制。") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { commitContextBudget() })
                )
            }
        }
        item {
            SettingGroup("输出偏好") {
                Text("回答长度", fontWeight = FontWeight.Medium)
                listOf("auto" to "自然", "short" to "偏短", "long" to "长信").forEach { (value, label) ->
                    ChoiceRow(label, settings.outputLength == value) { store.updateBasic { it.copy(outputLength = value) } }
                }
                NumberStepper("最大输出 token", settings.maxOutputTokens, 64, 65536, 512) { value ->
                    store.updateBasic { it.copy(maxOutputTokens = value) }
                }
                Text("表达倾向", fontWeight = FontWeight.Medium)
                listOf("stable" to "稳定", "balanced" to "自然", "expansive" to "发散").forEach { (value, label) ->
                    ChoiceRow(label, settings.creativity == value) { store.updateBasic { it.copy(creativity = value) } }
                }
            }
        }
        item {
            SettingGroup("生成方式") {
                BooleanRow("流式输出", settings.streamingEnabled) { value -> store.updateBasic { it.copy(streamingEnabled = value) } }
            }
        }
        item {
            SettingGroup("整理当前对话的纸条与记忆") {
                NumberStepper("当前对话纸条最多字数", settings.soilBudget, 300, 4000, 100) { value -> store.updateBasic { it.copy(soilBudget = value) } }
                NumberStepper("线索冷却轮数", settings.seedCooldownTurns, 0, 8, 1) { value -> store.updateBasic { it.copy(seedCooldownTurns = value) } }
                NumberStepper("本轮记忆召回上限", settings.memoryLimit, 0, 12, 1) { value -> store.updateBasic { it.copy(memoryLimit = value) } }
            }
        }
        item {
            SettingGroup("词典") {
                BooleanRow("世界书 / 词典", settings.worldbookEnabled) { value -> store.updateBasic { it.copy(worldbookEnabled = value) } }
                NumberStepper("每轮最多词条", settings.worldbookLimit, 0, 6, 1) { value -> store.updateBasic { it.copy(worldbookLimit = value) } }
            }
        }
        item {
            Text(
                "最近聊天轮数与上下文 token budget 都保存在本机。前端只提供推荐值，不设置人为上限；真正极限由现有历史与模型/provider 上下文窗口决定。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun BooleanRow(label: String, value: Boolean, onPick: (Boolean) -> Unit) {
    ChoiceRow("$label · ${if (value) "开启" else "关闭"}", value) { onPick(!value) }
}

@Composable
private fun NumberStepper(
    label: String,
    value: Int,
    min: Int,
    max: Int,
    step: Int,
    onPick: (Int) -> Unit
) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp)) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, fontWeight = FontWeight.Medium)
            Text(value.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("－", modifier = Modifier.clickable { onPick((value - step).coerceAtLeast(min)) }.padding(10.dp))
        Text("＋", modifier = Modifier.clickable { onPick((value + step).coerceAtMost(max)) }.padding(10.dp))
    }
}

@Composable
internal fun DiagnosticsScreen(shell: CoastShellState, wolf: WolfState) {
    val context = LocalContext.current
    val packageInfo = remember(context.packageName) {
        context.packageManager.getPackageInfo(context.packageName, 0)
    }
    @Suppress("DEPRECATION")
    val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        packageInfo.longVersionCode
    } else {
        packageInfo.versionCode.toLong()
    }
    val rows = listOf(
        "APK versionName" to (packageInfo.versionName ?: "unknown"),
        "APK versionCode" to versionCode.toString(),
        "当前主题" to wolf.appearance.theme.label,
        "当前 roomType" to shell.activeRoomType.wireValue,
        "当前 conversation id" to shell.activeConversationId,
        "当前模型" to shell.currentModel.ifBlank { "尚未载入" },
        "共享 conversation 数量" to shell.conversations.size.toString(),
        "当前消息数" to shell.messages.size.toString(),
        "INTERNET permission" to "是",
        "后端接线状态" to if (shell.backendOffline) "缓存可读 · 后端暂不可达" else "聊天主链已接线",
        "聊天 source of truth" to "Source D1 / shared history v4"
    )
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("关于与诊断", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        items(rows) { (label, value) ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp))
                    .padding(13.dp)
            ) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value)
            }
        }
    }
}
