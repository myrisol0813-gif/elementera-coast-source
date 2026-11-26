/*
 * Bottom-sheet search and selected-state interaction retain the selected
 * MIT-licensed MiniiChat-derived picker pattern from the PoC. Coast visuals,
 * strings and future profile semantics are rewritten for Native v1.
 */
package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.ui.platform.LocalContext
import kotlin.math.roundToInt
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import com.elementeracoast.app.feature.wolf.ModelSeries
import com.elementeracoast.app.feature.wolf.ModelKind
import com.elementeracoast.app.feature.wolf.ModelKindTabs
import com.elementeracoast.app.feature.wolf.ImageGroup
import com.elementeracoast.app.feature.wolf.CurrentImageCard
import com.elementeracoast.app.feature.wolf.imageModelItems
import com.elementeracoast.app.feature.wolf.OnlineVoiceInfo
import com.elementeracoast.app.feature.wolf.LocalVoicePanel
import androidx.compose.material3.OutlinedTextField
import com.elementeracoast.app.feature.wolf.LocalModelChannel
import com.elementeracoast.app.feature.wolf.classifyModelSeries
import com.elementeracoast.app.feature.wolf.localRawModelId
import com.elementeracoast.app.feature.wolf.localProviderId
import com.elementeracoast.app.core.local.LocalProviderStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.modelDisplayName
import com.elementeracoast.app.feature.chatgpt.ChatGptAccountModel
import com.elementeracoast.app.feature.chatgpt.ChatGptConnectState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelQuickPicker(
    models: List<String>,
    modelReasoningChoices: Map<String, List<String>>,
    currentModel: String,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
    chatGpt: ChatGptConnectState,
    onChatGptConnect: () -> Unit,
    onChatGptRefresh: () -> Unit,
    localMode: Boolean = false,
    onOpenModelBox: () -> Unit,
    imageModels: List<String> = emptyList(),
    currentImage: String = "",
    onPickImage: (String) -> Unit = {}
) {
    var query by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf(ModelKind.Chat) }
    var imageQuery by remember { mutableStateOf("") }
    var imageOpen by remember { mutableStateOf<Set<ImageGroup>>(emptySet()) }
    var channel by remember { mutableStateOf(if (currentModel.startsWith("chatgpt-plan:") || (currentModel.isBlank() && chatGpt.connected)) LocalModelChannel.Codex else LocalModelChannel.Provider) }
    var openGroups by remember { mutableStateOf<Set<ModelSeries>>(emptySet()) }
    val localContext = LocalContext.current
    val reasoningStore = remember(localContext) { ReasoningEffortStore.production(localContext) }
    val options = if (currentModel.startsWith("chatgpt-plan:")) {
        chatGpt.availableModels.firstOrNull { "chatgpt-plan:" + it.slug == currentModel }?.reasoningEfforts.orEmpty()
    } else modelReasoningChoices[currentModel].orEmpty()
    var chosenEffort by remember(currentModel, options) {
        mutableStateOf(reasoningStore.get(currentModel, options))
    }
    var providerNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(localMode, models) {
        if (localMode) providerNames = withContext(Dispatchers.IO) {
            runCatching { LocalProviderStore(localContext.applicationContext).load().associate { it.id to it.name } }.getOrDefault(emptyMap())
        }
    }
    LaunchedEffect(channel, chatGpt.connected) {
        if (channel == LocalModelChannel.Codex && chatGpt.connected && chatGpt.availableModels.isEmpty() && !chatGpt.busy) onChatGptRefresh()
    }
    val filtered = remember(models, chatGpt.availableModels, query, providerNames, localMode) {
        val ids = models.filter { if (localMode) it.startsWith("local:") && '/' in it else !it.startsWith("chatgpt-plan:") }
        val base = filterProviderCatalog(ids, chatGpt.availableModels, query)
        base.copy(coast = ids.filter { id -> id in base.coast || providerNames[localProviderId(id)].orEmpty().contains(query, ignoreCase = true) }.distinct())
    }
    val currentName = modelDisplayName(localRawModelId(currentModel)).ifBlank { "尚未选择" }
    val sections = listOf(ModelSeries.Free) + ModelSeries.entries.filter { it != ModelSeries.Free }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .heightIn(max = 650.dp)
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("选择模型", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                TextButton(onClick = onOpenModelBox) { Text("打开模型箱") }
            }
            Spacer(Modifier.height(4.dp))
            ModelKindTabs(kind){kind=it}
            Spacer(Modifier.height(8.dp))
            if(kind==ModelKind.Image){
                CurrentImageCard(currentImage)
                OutlinedTextField(imageQuery,{imageQuery=it},modifier=Modifier.fillMaxWidth(),singleLine=true,placeholder={Text("搜索生图模型")})
                LazyColumn(Modifier.fillMaxWidth().heightIn(max=420.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                    imageModelItems(imageModels,currentImage,imageQuery,imageOpen,{g->imageOpen=if(g in imageOpen)imageOpen-g else imageOpen+g},onPickImage)
                }
            } else if(kind==ModelKind.Voice){
                if(localMode) {
                    Text("本机独立语音 · ElevenLabs",style=MaterialTheme.typography.titleSmall)
                    TextButton(onClick=onOpenModelBox){Text("打开模型箱配置声音")}
                } else OnlineVoiceInfo()
            } else {
            Text(
                if (localMode) "本机供应商和已授权的 ChatGPT 套餐均可选用；在模型箱管理 Key 与 URL。" else "海岸 / OpenRouter 与官端 ChatGPT 套餐均可设为当前聊天模型。官端套餐参数按官方能力生效。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
            Spacer(Modifier.height(12.dp))
            Column(
                modifier = Modifier.fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .50f), RoundedCornerShape(18.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text("当前模型 · 推理强度", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                Text(currentName, style = MaterialTheme.typography.titleMedium)
                Text(
                    if (options.isEmpty()) "模型目录没有提供确切档位 · 保持默认"
                    else "按当前模型目录提供的档位选择；首格为模型默认",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                val tick = if (chosenEffort == null) 0 else options.indexOf(chosenEffort).takeIf { it >= 0 }?.plus(1) ?: 0
                if (options.isNotEmpty()) Slider(
                    value = tick.toFloat(),
                    onValueChange = { raw ->
                        val selected = raw.roundToInt().coerceIn(0, options.size)
                        val next = options.getOrNull(selected - 1)
                        chosenEffort = next
                        reasoningStore.set(currentModel, next, options)
                    },
                    valueRange = 0f..options.size.coerceAtLeast(1).toFloat(),
                    steps = (options.size - 1).coerceAtLeast(0),
                    enabled = options.isNotEmpty()
                )
                Text(
                    chosenEffort ?: "模型默认",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                QuickChannelCard("Codex", channel == LocalModelChannel.Codex, Modifier.weight(1f)) {
                    channel = LocalModelChannel.Codex; query = ""; openGroups = emptySet()
                }
                QuickChannelCard(if (localMode) "自有供应商" else "海岸 · OpenRouter", channel == LocalModelChannel.Provider, Modifier.weight(1f)) {
                    channel = LocalModelChannel.Provider; query = ""; openGroups = emptySet()
                }
            }
            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(18.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Search,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(19.dp)
                )
                Spacer(Modifier.size(9.dp))
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        color = MaterialTheme.colorScheme.onSurface
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    decorationBox = { inner ->
                        if (query.isEmpty()) {
                            Text(
                                "搜索此通道的模型",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        inner()
                    }
                )
            }

            Spacer(Modifier.height(13.dp))
            LazyColumn(
                modifier = Modifier.fillMaxWidth().heightIn(max = 450.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (channel == LocalModelChannel.Provider) {
                    if (filtered.coast.isEmpty()) item(key = "provider-empty") {
                        ProviderEmptyHint("没有符合条件的模型。可在模型箱添加供应商或刷新目录。")
                    }
                    val groups = filtered.coast.groupBy { classifyModelSeries(localRawModelId(it)) }
                    sections.forEach { series ->
                        val entries = groups[series].orEmpty()
                        if (entries.isNotEmpty()) {
                            val expanded = query.isNotBlank() || series in openGroups
                            item(key = "provider-group-${series.name}") {
                                QuickGroupHeader(series, entries.size, expanded) {
                                    openGroups = if (series in openGroups) openGroups - series else openGroups + series
                                }
                            }
                            if (expanded) items(entries, key = { "coast:$it" }) { id ->
                                val raw = localRawModelId(id)
                                val owner = if (localMode) providerNames[localProviderId(id)].orEmpty() else ""
                                QuickModelRow(modelDisplayName(raw), listOf(owner, raw).filter { it.isNotBlank() }.joinToString(" · "),
                                    currentModel == id, onPick = { onPick(id) })
                            }
                        }
                    }
                } else {
                    if (!chatGpt.connected) {
                        item(key = "official-connect") {
                            TextButton(onClick = onChatGptConnect, enabled = !chatGpt.busy) { Text("Continue with ChatGPT") }
                        }
                    } else {
                        item(key = "official-refresh") {
                            TextButton(onClick = onChatGptRefresh, enabled = !chatGpt.busy) { Text("刷新可用模型") }
                        }
                        if (filtered.official.isEmpty()) item(key = "official-empty") {
                            ProviderEmptyHint(if (chatGpt.availableModels.isEmpty()) "尚未读取到模型，请刷新目录。" else "没有符合条件的套餐模型。")
                        }
                        val groups = filtered.official.distinctBy { it.slug }.groupBy { classifyModelSeries(it.slug) }
                        sections.forEach { series ->
                            val entries = groups[series].orEmpty()
                            if (entries.isNotEmpty()) {
                                val expanded = query.isNotBlank() || series in openGroups
                                item(key = "official-group-${series.name}") {
                                    QuickGroupHeader(series, entries.size, expanded) {
                                        openGroups = if (series in openGroups) openGroups - series else openGroups + series
                                    }
                                }
                                if (expanded) items(entries, key = { "official:${it.slug}" }) { model ->
                                    QuickModelRow(model.displayName, model.slug, currentModel == "chatgpt-plan:" + model.slug,
                                        onPick = { onPick("chatgpt-plan:" + model.slug) })
                                }
                            }
                        }
                    }
                }

                if (channel == LocalModelChannel.Codex && (chatGpt.busy || chatGpt.message.isNotBlank() || chatGpt.probe != null)) {
                    item(key = "chatgpt-provider-status") {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .65f),
                                    RoundedCornerShape(16.dp)
                                )
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(5.dp)
                        ) {
                            if (chatGpt.busy) Text(
                                "正在连接或等待模型回复……",
                                style = MaterialTheme.typography.bodySmall
                            )
                            if (chatGpt.message.isNotBlank()) Text(
                                chatGpt.message,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            chatGpt.probe?.let { result ->
                                Text("最近一次独立测试 · " + result.text, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    "输入 ${result.inputTokens ?: "未报告"} · 缓存读取 ${result.cachedTokens ?: "未报告"} · 输出 ${result.outputTokens ?: "未报告"}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

internal data class ProviderCatalogSelection(
    val coast: List<String>,
    val official: List<ChatGptAccountModel>
)

internal fun filterProviderCatalog(
    coastModels: List<String>,
    officialModels: List<ChatGptAccountModel>,
    query: String
): ProviderCatalogSelection = ProviderCatalogSelection(
    coast = coastModels.filter { it.contains(query, ignoreCase = true) ||
        modelDisplayName(it).contains(query, ignoreCase = true) },
    official = officialModels.filter { it.slug.contains(query, ignoreCase = true) ||
        it.displayName.contains(query, ignoreCase = true) }
)

@Composable
private fun QuickChannelCard(title: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f), RoundedCornerShape(18.dp))
        .clickable(onClick = onClick).padding(12.dp), contentAlignment = Alignment.Center) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun QuickGroupHeader(series: ModelSeries, count: Int, expanded: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f), RoundedCornerShape(18.dp))
        .clickable(onClick = onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (series == ModelSeries.OtherOpenAi) "其他模型" else series.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
        Text("$count  " + if (expanded) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun QuickModelRow(title: String, subtitle: String, selected: Boolean, onPick: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp))
        .clickable(onClick = onPick).padding(horizontal = 15.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (selected) Icon(Icons.Default.Check, contentDescription = "当前模型")
    }
}

@Composable
private fun ProviderEmptyHint(message: String) {
    Text(
        message,
        modifier = Modifier.padding(horizontal = 15.dp, vertical = 12.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}
