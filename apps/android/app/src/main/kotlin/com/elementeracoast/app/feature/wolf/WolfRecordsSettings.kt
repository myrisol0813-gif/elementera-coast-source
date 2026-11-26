package com.elementeracoast.app.feature.wolf

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
import kotlinx.serialization.json.JsonElement
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun ChatRecordsScreen(
    profile: WolfProfile,
    messages: List<ChatMessage>,
    archive: GlobalArchiveRepository,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit,
    localMode: Boolean = false,
    nativeSettings: WolfState? = null,
    transferAllowed: Boolean = true
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val stamp = remember { DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(LocalDateTime.now()) }
    var busy by remember { mutableStateOf(false) }
    val operations = remember(archive, localMode, context) { (archive as? DefaultGlobalArchiveRepository)?.archiveV2(context, localMode) }
    val htmlExport = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if(uri==null || operations==null){busy=false;return@rememberLauncherForActivityResult}
        scope.launch {
            runCatching {
                val (file,manifest)=operations.export { _,_-> }
                try {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { output ->
                            OfflineV2HtmlArchive.write(file,output,GlobalArchive.withNativeSettings(kotlinx.serialization.json.JsonObject(emptyMap()),nativeSettings,localMode))
                        }?:error("无法打开目标文件")
                    }
                }finally{file.parentFile?.deleteRecursively()}
            }.onSuccess { warnings ->
                onSnackbar(if(warnings.isEmpty())"离线 HTML ZIP 已导出；范围见清单，解压后打开 index.html" else "离线归档已导出；有缺失，详见 manifest.json")
            }.onFailure { onSnackbar("离线归档失败："+it.message) }
            busy=false
        }
    }
    fun launchHtml(){
        if(busy||operations==null)return
        busy=true
        htmlExport.launch("elementera-coast-offline-$stamp.zip")
    }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("海岸归档", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        item {
            if(operations!=null) ArchiveV2Panel(operations,archive,localMode,transferAllowed&&!busy,onSnackbar,htmlBusy=busy,onExportHtml=::launchHtml)
            else Text("归档暂不可用，请重新进入海岸。",color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun BasicSettingsScreen(settings: BasicSettings, store: WolfStore, onSnackbar: (String) -> Unit) {
    var recentTurnsText by remember(settings.recentTurns) { mutableStateOf(settings.recentTurns.toString()) }
    var toolLimitText by remember(settings.toolCallLimit) { mutableStateOf(settings.toolCallLimit.toString()) }
    var contextBudgetText by remember(settings.contextBudget) { mutableStateOf(if(settings.contextBudget==0)"" else settings.contextBudget.toString()) }

    fun commitRecentTurns() {
        val parsed = recentTurnsText.toIntOrNull()
        val value = if (parsed != null && parsed >= 1) parsed else 8
        recentTurnsText = value.toString()
        if (value == settings.recentTurns) return
        store.updateBasic { it.copy(recentTurns = value) }
        onSnackbar("当前设备最近聊天轮数已设为 $value")
    }

    fun commitContextBudget() {
        if(settings.contextBudget==0)return
        val parsed = contextBudgetText.toIntOrNull()
        if(parsed==null||parsed<1800){
            contextBudgetText=settings.contextBudget.toString()
            onSnackbar("手动预算需为至少1800的整数；原设置已保留。")
            return
        }
        val value=parsed
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
                ChoiceRow("自动",settings.contextBudget==0){store.updateBasic{it.copy(contextBudget=0)}}
                ChoiceRow("手动",settings.contextBudget!=0){if(settings.contextBudget==0)store.updateBasic{it.copy(contextBudget=6000)}}
                if(settings.contextBudget==0) Text("依据模型目录容量预留输出及工具空间；未提供容量时采用18000的舒服区间，不代表模型真实上限。",style=MaterialTheme.typography.bodySmall)
                if(settings.contextBudget!=0) OutlinedTextField(
                    value = contextBudgetText,
                    onValueChange = { raw -> contextBudgetText = raw.filter(Char::isDigit) },
                    modifier = Modifier.fillMaxWidth().onFocusChanged { state ->
                        if (!state.isFocused) commitContextBudget()
                    },
                    suffix = { Text("tokens") },
                    supportingText = { Text("最小1800，无人为固定上限；已知模型目录容量时会限制估算输入，回执显示实际采用的预算。") },
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
            SettingGroup("模型运行与额度") {
                OutlinedTextField(toolLimitText,{toolLimitText=it.filter(Char::isDigit).take(3)},modifier=Modifier.fillMaxWidth(),singleLine=true,
                    label={Text("单轮普通工具调用上限")},suffix={Text("次")},
                    supportingText={Text("默认24；可手动输入1—128。达到上限后保留已完成操作，停止新调用并完成正文。上下文、供应商及付费媒体防重复保护另计。")},
                    keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number,imeAction=ImeAction.Done))
                androidx.compose.material3.TextButton(onClick={
                    val parsed=toolLimitText.toIntOrNull()
                    if(parsed==null||parsed !in 1..128) onSnackbar("请输入1—128的整数，原设置保留。")
                    else {store.updateBasic{it.copy(toolCallLimit=parsed)};onSnackbar("本机设置已保存，下一轮生效。")}
                }){Text("保存工具次数")}
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
