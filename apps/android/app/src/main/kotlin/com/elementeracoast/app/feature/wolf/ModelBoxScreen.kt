package com.elementeracoast.app.feature.wolf

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import com.elementeracoast.app.core.local.LocalProviderStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Button
import androidx.compose.material3.TextButton
import com.elementeracoast.app.feature.chatgpt.ChatGptConnectState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal enum class LocalModelPage(val title: String) { Catalog("模型目录"), Codex("Codex 额度"), Providers("自有供应商") }

@Composable
internal fun ModelBoxScreen(
    models: List<String>,
    current: String,
    onSelect: (String) -> Unit,
    onRefresh: () -> Unit,
    chatGpt: ChatGptConnectState,
    onChatGptConnect: () -> Unit,
    onChatGptDisconnect: () -> Unit,
    onChatGptRefresh: () -> Unit,
    onChatGptProbe: (String) -> Unit,
    localMode: Boolean = false,
    localPage: LocalModelPage = LocalModelPage.Catalog,
    onLocalPage: (LocalModelPage) -> Unit = {}
) {
    var expandedModel by remember { mutableStateOf<String?>(null) }
    val grouped = remember(models, current) { groupedUnselectedModels(models, current) }
    var query by remember { mutableStateOf("") }
    var channel by remember { mutableStateOf(if (current.startsWith("local:") || !chatGpt.connected) LocalModelChannel.Provider else LocalModelChannel.Codex) }
    var openGroups by remember { mutableStateOf<Set<ModelSeries>>(emptySet()) }
    val context = LocalContext.current.applicationContext
    var providerNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(localMode, models, localPage) {
        if (localMode) providerNames = withContext(Dispatchers.IO) {
            runCatching { LocalProviderStore(context).load().associate { it.id to it.name } }.getOrDefault(emptyMap())
        }
    }
    val catalogModels = models + chatGpt.availableModels.map { "chatgpt-plan:" + it.slug }
    val localGrouped = remember(catalogModels, query, providerNames, channel, chatGpt.connected) {
        groupedLocalModels(localChannelModels(catalogModels, channel, chatGpt.connected), query, providerNames)
    }
    if (localMode && localPage != LocalModelPage.Catalog) {
        LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                if (localPage == LocalModelPage.Codex) {
                    ChatGptPlanCard(chatGpt, onChatGptConnect, onChatGptDisconnect, onChatGptRefresh, onSelect, onChatGptProbe, localMode = true)
                    Text("套餐剩余额度以账户服务为准；当前未提供剩余额度数值。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else LocalProviderPanel(current, onRefresh)
            }
        }
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (!localMode) item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("模型箱", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        if (localMode) "本机模式 · 供应商与账户" else "海岸 · OpenRouter 模型目录，与 PWA 共用当前聊天模型",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Row(
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp))
                        .clickable(onClick = onRefresh)
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null)
                    Text("刷新", style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        item {
            Text("当前模型", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            CurrentModelCard(current, if (!localMode) "" else if (current.startsWith("chatgpt-plan:")) "ChatGPT 套餐" else providerNames[localProviderId(current)].orEmpty())
        }

        if (localMode) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    LocalModelEntry("Codex 额度", if (chatGpt.connected) "已授权 · 账户与模型" else "账户与授权", Modifier.weight(1f), channel == LocalModelChannel.Codex) {
                        channel = LocalModelChannel.Codex
                        expandedModel = null
                        query = ""
                        openGroups = emptySet()
                    }
                    LocalModelEntry("自有供应商", "API · URL · 额度", Modifier.weight(1f), channel == LocalModelChannel.Provider) {
                        channel = LocalModelChannel.Provider
                        expandedModel = null
                        query = ""
                        openGroups = emptySet()
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (channel == LocalModelChannel.Codex) "ChatGPT 套餐模型" else "自有 API 模型",
                        Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    TextButton(onClick = { onLocalPage(if (channel == LocalModelChannel.Codex) LocalModelPage.Codex else LocalModelPage.Providers) }) {
                        Text(if (channel == LocalModelChannel.Codex) "账户管理" else "供应商管理")
                    }
                }
            }
            item {
                OutlinedTextField(value = query, onValueChange = { query = it }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp),
                    placeholder = { Text("搜索此通道的模型") })
            }
            val sections = if (channel == LocalModelChannel.Codex) ModelSeries.entries.filter { localGrouped[it].orEmpty().isNotEmpty() } else listOf(ModelSeries.Free) + ModelSeries.entries.filter { it != ModelSeries.Free }
            sections.forEach { series ->
                val entries = localGrouped[series].orEmpty()
                if (entries.isNotEmpty() || query.isBlank()) {
                    val opened = query.isNotBlank() || series in openGroups
                    item(key = "local-series-${series.name}") {
                        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f), RoundedCornerShape(18.dp))
                            .clickable { openGroups = if (series in openGroups) openGroups - series else openGroups + series }.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(if (series == ModelSeries.OtherOpenAi) "其他模型" else series.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text("${entries.size}  " + if (opened) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (opened) {
                        if (entries.isEmpty()) item(key = "local-empty-${series.name}") { Text("暂无模型", style = MaterialTheme.typography.bodySmall) }
                        items(entries, key = { "local-model:${it.id}" }) { item ->
                            val owner = if (item.id.startsWith("chatgpt-plan:")) "ChatGPT 套餐" else providerNames[localProviderId(item.id)] ?: "供应商 " + localProviderId(item.id).take(8)
                            ModelCatalogBubble(item = item, expanded = expandedModel == item.id,
                                selected = current == item.id, source = owner, rawId = localRawModelId(item.id),
                                onToggle = { expandedModel = if (expandedModel == item.id) null else item.id },
                                onSelect = { onSelect(item.id); expandedModel = null })
                        }
                    }
                }
            }
            if (localGrouped.values.all { it.isEmpty() }) item {
                Text(if (query.isNotBlank()) "未找到匹配模型。" else if (channel == LocalModelChannel.Codex) "暂无套餐模型，请在账户管理授权或刷新。" else "暂无供应商模型，请添加供应商并获取模型。", style = MaterialTheme.typography.bodySmall)
            }
        } else {
        item {
            ChatGptPlanCard(chatGpt, onChatGptConnect, onChatGptDisconnect, onChatGptRefresh, onSelect, onChatGptProbe)
        }

        item {
            Text("海岸 · OpenRouter", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        ModelSeries.entries.forEach { series ->
            item(key = "model-series-${series.name}") {
                Text(
                    series.title,
                    modifier = Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold
                )
            }

            val entries = grouped[series].orEmpty()
            if (entries.isEmpty()) {
                item(key = "model-series-${series.name}-empty") {
                    Text(
                        "暂无目录项",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            } else {
                items(
                    items = entries,
                    key = { item -> "${series.name}:${item.id}" }
                ) { item ->
                    ModelCatalogBubble(
                        item = item,
                        expanded = expandedModel == item.id,
                        onToggle = { expandedModel = if (expandedModel == item.id) null else item.id },
                        onSelect = {
                            onSelect(item.id)
                            expandedModel = null
                        }
                    )
                }
            }
        }

        item {
            Text(
                "刷新读取海岸 /api/models；设为当前后写回共享 profile，PWA 与 Native 会读取同一状态。",
                modifier = Modifier.padding(top = 4.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
        }
    }
}

@Composable
private fun LocalModelEntry(title: String, subtitle: String, modifier: Modifier, selected: Boolean, onClick: () -> Unit) {
    Surface(modifier = modifier.clickable(onClick = onClick), shape = RoundedCornerShape(20.dp), color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CurrentModelCard(model: String, source: String = "") {
    val shape = RoundedCornerShape(18.dp)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        shadowElevation = 1.dp
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Text(
                model.removePrefix("chatgpt-plan:").substringAfterLast('/').ifBlank { "尚未载入" },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                if (source.isBlank()) "正在使用" else "$source · 正在使用",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun ModelCatalogBubble(
    item: LocalModelCatalogItem,
    expanded: Boolean,
    onToggle: () -> Unit,
    onSelect: () -> Unit,
    selected: Boolean = false,
    source: String = "海岸后端",
    rawId: String = item.id
) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface, shape)
            .clickable(onClick = onToggle)
            .padding(horizontal = 15.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                (if (selected) "当前 · " else "") + item.displayName,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(if (expanded) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (item.id.startsWith("local:") || item.id.startsWith("chatgpt-plan:")) Text(source, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            Text(rawId, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Text(item.series.title, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Text(
                "目录来源：$source",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(9.dp))
            Text(
                "设为当前",
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = .12f), RoundedCornerShape(13.dp))
                    .clickable(onClick = onSelect)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}


@Composable
private fun ChatGptPlanCard(
    state: ChatGptConnectState,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onRefresh: () -> Unit,
    onSelect: (String) -> Unit,
    onProbe: (String) -> Unit,
    localMode: Boolean = false
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .65f)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("ChatGPT 套餐", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                if (state.connected) "已授权：" + state.accountLabel
                else "通过系统浏览器授权；凭证只加密保存在本机。",
                color = muted, style = MaterialTheme.typography.bodySmall
            )
            Text(
                if (localMode) "本机文字聊天 · 使用已授权的套餐额度；本机思维壤尚未接入。" else "ChatGPT 套餐可用于普通聊天。当前对话纸条由后端准备任务，再由本机已授权的 ChatGPT 模型完成整理；账户授权不会上传到 Coast 后端。",
                color = muted, style = MaterialTheme.typography.bodySmall
            )
            if (state.busy) {
                Text("正在与 ChatGPT 建立连接，请稍候……", color = muted, style = MaterialTheme.typography.bodySmall)
            }
            if (state.connected) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = onRefresh, enabled = !state.busy) { Text("刷新可用模型") }
                    TextButton(onClick = onDisconnect, enabled = !state.busy) { Text("断开授权") }
                }
                state.availableModels.forEach { model ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(model.displayName, style = MaterialTheme.typography.bodyMedium)
                            if (model.slug != model.displayName) {
                                Text(model.slug, color = muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        TextButton(onClick = { onSelect("chatgpt-plan:" + model.slug) }, enabled = !state.busy) {
                            Text("设为当前")
                        }
                        TextButton(onClick = { onProbe(model.slug) }, enabled = !state.busy) {
                            Text("测试回复")
                        }
                    }
                }
            } else {
                Button(onClick = onConnect, enabled = !state.busy) { Text("Continue with ChatGPT") }
            }
            if (state.message.isNotBlank()) {
                Text(state.message, color = muted, style = MaterialTheme.typography.bodySmall)
            }
            state.probe?.let { result ->
                Text(result.text, style = MaterialTheme.typography.bodyMedium)
                Text(
                    "真实用量 · 输入 " + (result.inputTokens?.toString() ?: "未报告") +
                        " · 缓存读取 " + (result.cachedTokens?.toString() ?: "未报告") +
                        " · 输出 " + (result.outputTokens?.toString() ?: "未报告"),
                    color = muted, style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}
