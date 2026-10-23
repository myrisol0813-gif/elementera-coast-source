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
import androidx.compose.foundation.shape.CircleShape
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
    onChatGptProbe: (String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    val localContext = LocalContext.current
    val reasoningStore = remember(localContext) { ReasoningEffortStore.production(localContext) }
    val options = if (currentModel.startsWith("chatgpt-plan:")) {
        chatGpt.availableModels.firstOrNull { "chatgpt-plan:" + it.slug == currentModel }?.reasoningEfforts.orEmpty()
    } else modelReasoningChoices[currentModel].orEmpty()
    var chosenEffort by remember(currentModel, options) {
        mutableStateOf(reasoningStore.get(currentModel, options))
    }
    val filtered = remember(models, chatGpt.availableModels, query) {
        filterProviderCatalog(models, chatGpt.availableModels, query)
    }

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
            Text(
                "选择模型",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "海岸 / OpenRouter 与官端 ChatGPT 套餐均可设为当前聊天模型。官端套餐参数按官方能力生效。",
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
                Text(
                    if (options.isEmpty()) "模型目录没有提供确切档位 · 保持默认"
                    else "按当前模型目录提供的档位选择；首格为模型默认",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                val tick = if (chosenEffort == null) 0 else options.indexOf(chosenEffort).takeIf { it >= 0 }?.plus(1) ?: 0
                Slider(
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
            Spacer(Modifier.height(16.dp))

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
                                "搜索模型",
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
                item(key = "coast-provider-heading") {
                    ProviderSectionHeading("海岸 · OpenRouter", "可选择当前聊天模型")
                }
                if (filtered.coast.isEmpty()) {
                    item(key = "coast-provider-empty") {
                        ProviderEmptyHint("没有符合搜索条件的海岸模型。")
                    }
                }
                items(filtered.coast, key = { "coast:$it" }) { model ->
                    val selected = model == currentModel
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                if (selected) MaterialTheme.colorScheme.primaryContainer
                                else MaterialTheme.colorScheme.surface,
                                RoundedCornerShape(16.dp)
                            )
                            .clickable { onPick(model) }
                            .padding(horizontal = 15.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                modelDisplayName(model),
                                color = MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            if (selected) {
                                Text(
                                    "当前模型",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        }
                        if (selected) {
                            Box(
                                modifier = Modifier
                                    .size(28.dp)
                                    .background(MaterialTheme.colorScheme.primary, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = "已选择",
                                    tint = MaterialTheme.colorScheme.onPrimary,
                                    modifier = Modifier.size(17.dp)
                                )
                            }
                        }
                    }
                }

                item(key = "chatgpt-provider-heading") {
                    ProviderSectionHeading(
                        "官端 GPT · ChatGPT 套餐",
                        if (chatGpt.connected) "本机已连接 · 可选择正式聊天 / 测试回复"
                        else "未连接 · 在此登录后可测试可用模型"
                    )
                }
                if (!chatGpt.connected) {
                    item(key = "chatgpt-provider-connect") {
                        TextButton(onClick = onChatGptConnect, enabled = !chatGpt.busy) {
                            Text("Continue with ChatGPT")
                        }
                    }
                } else {
                    item(key = "chatgpt-provider-refresh") {
                        TextButton(onClick = onChatGptRefresh, enabled = !chatGpt.busy) {
                            Text("刷新官端 GPT 目录")
                        }
                    }
                    if (filtered.official.isEmpty()) {
                        item(key = "chatgpt-provider-empty") {
                            ProviderEmptyHint(
                                if (chatGpt.availableModels.isEmpty()) "尚未读取到模型；可点上方刷新目录。"
                                else "没有符合搜索条件的官端 GPT 模型。"
                            )
                        }
                    }
                    items(filtered.official, key = { "official:${it.slug}" }) { item ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    if (currentModel == "chatgpt-plan:" + item.slug) MaterialTheme.colorScheme.primaryContainer
                                    else MaterialTheme.colorScheme.surface,
                                    RoundedCornerShape(16.dp)
                                )
                                .clickable { onPick("chatgpt-plan:" + item.slug) }
                                .padding(horizontal = 15.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    item.displayName,
                                    style = MaterialTheme.typography.bodyLarge,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    item.slug,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            if (currentModel == "chatgpt-plan:" + item.slug) {
                                Icon(Icons.Default.Check, contentDescription = "当前官端 GPT 模型")
                            }
                            TextButton(
                                onClick = { onChatGptProbe(item.slug) },
                                enabled = !chatGpt.busy
                            ) { Text("测试回复") }
                        }
                    }
                }

                if (chatGpt.busy || chatGpt.message.isNotBlank() || chatGpt.probe != null) {
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
private fun ProviderSectionHeading(title: String, description: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 4.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(
            description,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
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
