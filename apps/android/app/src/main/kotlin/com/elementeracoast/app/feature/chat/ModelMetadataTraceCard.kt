package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.elementeracoast.app.core.remote.RemoteMessageModelMetadataResponse
import com.elementeracoast.app.core.remote.RemoteModelMetadata
import com.elementeracoast.app.ui.theme.CoastChatTokens
import kotlinx.serialization.json.JsonElement

internal class ModelMetadataTraceState(
    val conversationId: String,
    val messageId: String,
    val source: ModelMetadataRemoteDataSource
) {
    var expanded by mutableStateOf(false)
    var rawExpanded by mutableStateOf(false)
    var response by mutableStateOf<RemoteMessageModelMetadataResponse?>(null)
    var loading by mutableStateOf(false)
    var errorText by mutableStateOf("")
}

@Composable
internal fun rememberModelMetadataTraceState(
    conversationId: String,
    messageId: String,
    source: ModelMetadataRemoteDataSource
): ModelMetadataTraceState {
    val state = remember(conversationId, messageId, source) {
        ModelMetadataTraceState(conversationId, messageId, source)
    }

    LaunchedEffect(state.expanded, state.messageId) {
        if (!state.expanded || state.response != null || state.loading) return@LaunchedEffect
        state.loading = true
        state.errorText = ""
        runCatching { state.source.get(state.conversationId, state.messageId, includeRaw = false) }
            .onSuccess { state.response = it }
            .onFailure { state.errorText = it.message ?: "模型回波读取失败。" }
        state.loading = false
    }

    LaunchedEffect(state.rawExpanded, state.messageId) {
        if (!state.rawExpanded || state.loading || state.response?.rawMetadataSanitized != null) return@LaunchedEffect
        state.loading = true
        runCatching { state.source.get(state.conversationId, state.messageId, includeRaw = true) }
            .onSuccess { state.response = it }
            .onFailure { state.errorText = it.message ?: "脱敏原始回包读取失败。" }
        state.loading = false
    }

    return state
}

@Composable
internal fun ModelMetadataTraceChip(
    state: ModelMetadataTraceState,
    modifier: Modifier = Modifier
) {
    Text(
        text = "推理痕迹与模型回波",
        modifier = modifier
            .background(
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (state.expanded) .68f else .50f),
                RoundedCornerShape(CoastChatTokens.MetadataRadius)
            )
            .border(
                width = androidx.compose.ui.unit.Dp.Hairline,
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .72f),
                shape = RoundedCornerShape(CoastChatTokens.MetadataRadius)
            )
            .clickable { state.expanded = !state.expanded }
            .padding(
                horizontal = CoastChatTokens.MetadataHorizontalPadding,
                vertical = CoastChatTokens.MetadataTopGap
            ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelMedium.copy(
            fontSize = CoastChatTokens.MetadataTitleSize,
            fontWeight = FontWeight.SemiBold
        )
    )
}

@Composable
internal fun ModelMetadataTracePanel(
    state: ModelMetadataTraceState,
    modifier: Modifier = Modifier
) {
    if (!state.expanded) return
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .48f),
                RoundedCornerShape(CoastChatTokens.MetadataRadius)
            )
            .border(
                width = androidx.compose.ui.unit.Dp.Hairline,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(CoastChatTokens.MetadataRadius)
            )
            .padding(
                horizontal = CoastChatTokens.MetadataHorizontalPadding,
                vertical = CoastChatTokens.MetadataVerticalPadding
            )
    ) {
        when {
            state.loading && state.response == null -> MetadataMuted("正在读取模型回波……")
            state.errorText.isNotBlank() && state.response == null -> MetadataMuted(state.errorText)
            state.response == null -> MetadataMuted("本轮模型没有返回可展示的模型回波。")
            else -> MetadataBody(
                response = state.response!!,
                rawExpanded = state.rawExpanded,
                rawLoading = state.loading && state.rawExpanded,
                onToggleRaw = { state.rawExpanded = !state.rawExpanded },
                errorText = state.errorText
            )
        }
    }
}

@Composable
internal fun ModelMetadataTraceCard(
    conversationId: String,
    messageId: String,
    source: ModelMetadataRemoteDataSource,
    modifier: Modifier = Modifier
) {
    val state = rememberModelMetadataTraceState(conversationId, messageId, source)
    Column(
        modifier = modifier.padding(top = CoastChatTokens.MetadataTopGap),
        horizontalAlignment = Alignment.End
    ) {
        ModelMetadataTraceChip(state = state)
        if (state.expanded) {
            Spacer(Modifier.height(CoastChatTokens.MetadataRowGap))
            ModelMetadataTracePanel(state = state)
        }
    }
}

@Composable
private fun MetadataBody(
    response: RemoteMessageModelMetadataResponse,
    rawExpanded: Boolean,
    rawLoading: Boolean,
    onToggleRaw: () -> Unit,
    errorText: String
) {
    val metadata = response.metadata
    MetadataMuted("${statusLabel(response.status)}${if (response.sanitized) " · 已脱敏" else ""}")
    MetadataDivider()
    ReasoningSection(metadata)
    MetadataDivider()
    UsageSection(metadata)
    MetadataDivider()
    ProviderSection(metadata)
    MetadataDivider()
    FinishStatusSection(metadata)
    MetadataDivider()
    ToolTraceSection(metadata)
    MetadataDivider()
    RequestParamsSection(metadata)
    MetadataDivider()
    RawMetadataSection(response, rawExpanded, rawLoading, onToggleRaw)
    if (errorText.isNotBlank()) {
        Spacer(Modifier.height(CoastChatTokens.MetadataRowGap))
        MetadataMuted(errorText)
    }
}

@Composable
private fun ReasoningSection(metadata: RemoteModelMetadata?) {
    MetadataSectionTitle("推理痕迹")
    val summary = metadata?.reasoningSummary?.takeIf(String::isNotBlank)
    val text = metadata?.reasoningText?.takeIf(String::isNotBlank)
    val details = metadata?.reasoningDetails?.let(::compactJson)
    if (summary == null && text == null && details == null) {
        MetadataMuted("本轮模型没有返回可展示的推理痕迹。")
    } else {
        summary?.let { MetadataRow("推理摘要", it) }
        text?.let { MetadataRow("推理文本", it) }
        details?.let { MetadataRow("结构化详情", it) }
    }
    if (metadata?.reasoningEncryptedContentPresent == true) {
        val encrypted = buildList {
            add("存在加密推理内容")
            metadata.reasoningEncryptedContentLength?.let { add("长度 $it") }
            metadata.reasoningEncryptedContentDigest?.takeIf(String::isNotBlank)?.let { add("digest $it") }
        }.joinToString(" · ")
        MetadataRow("加密内容", encrypted)
    }
}

@Composable
private fun UsageSection(metadata: RemoteModelMetadata?) {
    MetadataSectionTitle("用量")
    val usage = metadata?.usage
    val rows = buildList {
        usage?.promptTokens?.let { add("输入" to "$it tokens") }
        usage?.completionTokens?.let { add("输出" to "$it tokens") }
        usage?.reasoningTokens?.let { add("推理" to "$it tokens") }
        usage?.cachedTokens?.let { add("缓存读取" to "$it tokens") }
        usage?.cacheWriteTokens?.let { add("缓存写入" to "$it tokens") }
        val rate = promptCacheHitRate(usage?.promptTokens, usage?.cachedTokens)
        if (rate != null) add("缓存命中率" to rate)
        else if (usage?.promptTokens != null) add("缓存命中率" to "供应商未报告有效缓存读取数据")
        usage?.cacheDiscount?.let {
            add("缓存折扣" to "$it USD（供应商回执；负数表示额外写入成本）")
        }
        usage?.totalTokens?.let { add("总计" to "$it tokens") }
        usage?.cost?.let { add("成本" to it.toString()) }
    }
    if (rows.isEmpty()) MetadataMuted("本轮供应商没有返回用量字段。") else rows.forEach { MetadataRow(it.first, it.second) }
}

@Composable
private fun ProviderSection(metadata: RemoteModelMetadata?) {
    MetadataSectionTitle("模型与供应商")
    val rows = buildList {
        metadata?.requestedModel?.takeIf(String::isNotBlank)?.let { add("请求模型" to it) }
        metadata?.resolvedModel?.takeIf(String::isNotBlank)?.let { add("实际模型" to it) }
        metadata?.provider?.takeIf(String::isNotBlank)?.let { add("Provider" to it) }
        metadata?.providerRoute?.let { add("Route / fallback" to compactJson(it)) }
    }
    if (rows.isEmpty()) MetadataMuted("本轮没有返回额外的模型路由信息。") else rows.forEach { MetadataRow(it.first, it.second) }
}

@Composable
private fun FinishStatusSection(metadata: RemoteModelMetadata?) {
    MetadataSectionTitle("完成状态")
    val rows = buildList {
        metadata?.finishReason?.takeIf(String::isNotBlank)?.let { add("finish_reason" to it) }
        metadata?.nativeFinishReason?.takeIf(String::isNotBlank)?.let { add("native_finish_reason" to it) }
        metadata?.isStream?.let { add("模式" to if (it) "streaming" else "non-streaming") }
        if (metadata?.isAborted == true) add("中断" to "是")
        if (metadata?.isTimeout == true) add("超时" to "是")
        metadata?.errorSummary?.takeIf(String::isNotBlank)?.let { add("错误摘要" to it) }
    }
    if (rows.isEmpty()) MetadataMuted("本轮没有额外完成状态。") else rows.forEach { MetadataRow(it.first, it.second) }
}

@Composable
private fun ToolTraceSection(metadata: RemoteModelMetadata?) {
    MetadataSectionTitle("工具调用")
    val calls = metadata?.toolCalls?.let(::compactJson)
    val results = metadata?.toolResults?.let(::compactJson)
    if (calls == null && results == null) MetadataMuted("本轮没有返回工具调用痕迹。")
    calls?.let { MetadataRow("tool_calls", it) }
    results?.let { MetadataRow("tool_results", it) }
}

@Composable
private fun RequestParamsSection(metadata: RemoteModelMetadata?) {
    MetadataSectionTitle("请求参数")
    val request = metadata?.request
    val rows = buildList {
        request?.temperature?.let { add("temperature" to it.toString()) }
        request?.topP?.let { add("top_p" to it.toString()) }
        request?.maxTokens?.let { add("max_tokens" to it.toString()) }
        request?.reasoningEffort?.takeIf(String::isNotBlank)?.let { add("reasoning_effort" to it) }
        request?.reasoningMaxTokens?.let { add("reasoning_max_tokens" to it.toString()) }
        request?.stream?.let { add("stream" to it.toString()) }
        request?.responseFormat?.let { add("response_format" to compactJson(it)) }
    }
    if (rows.isEmpty()) MetadataMuted("本轮没有可展示的请求参数。") else rows.forEach { MetadataRow(it.first, it.second) }
}

@Composable
private fun RawMetadataSection(
    response: RemoteMessageModelMetadataResponse,
    expanded: Boolean,
    loading: Boolean,
    onToggle: () -> Unit
) {
    Text(
        text = if (expanded) "⌃ 脱敏后的原始回包" else "⌄ 脱敏后的原始回包",
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(vertical = CoastChatTokens.MetadataRowGap),
        color = MaterialTheme.colorScheme.onSurface,
        style = MaterialTheme.typography.labelMedium.copy(
            fontSize = CoastChatTokens.MetadataTitleSize,
            fontWeight = FontWeight.SemiBold
        )
    )
    if (!expanded) return
    if (loading && response.rawMetadataSanitized == null) {
        MetadataMuted("正在读取脱敏回包……")
        return
    }
    val raw = response.rawMetadataSanitized
    if (raw == null) {
        MetadataMuted("本轮没有保存可展示的 raw metadata。")
        return
    }
    Text(
        text = compactJson(raw),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = CoastChatTokens.MetadataRawMaxHeight)
            .verticalScroll(rememberScrollState())
            .background(MaterialTheme.colorScheme.surface.copy(alpha = .68f), RoundedCornerShape(CoastChatTokens.MetadataRadius))
            .padding(CoastChatTokens.MetadataHorizontalPadding),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
    )
}

@Composable
private fun MetadataSectionTitle(title: String) {
    Text(
        title,
        color = MaterialTheme.colorScheme.onSurface,
        style = MaterialTheme.typography.labelMedium.copy(
            fontSize = CoastChatTokens.MetadataTitleSize,
            fontWeight = FontWeight.SemiBold
        )
    )
    Spacer(Modifier.height(CoastChatTokens.MetadataRowGap))
}

@Composable
private fun MetadataRow(label: String, value: String) {
    if (value.isBlank()) return
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = CoastChatTokens.MetadataRowGap / 2f)) {
        Text(
            label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.MetadataBodySize)
        )
        Text(
            value,
            modifier = Modifier.padding(top = CoastChatTokens.MetadataRowGap / 2f),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.MetadataBodySize)
        )
    }
}

@Composable
private fun MetadataMuted(text: String) {
    Text(
        text,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .78f),
        style = MaterialTheme.typography.bodySmall.copy(fontSize = CoastChatTokens.MetadataBodySize)
    )
}

@Composable
private fun MetadataDivider() {
    Spacer(Modifier.height(CoastChatTokens.MetadataSectionGap))
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .62f))
    Spacer(Modifier.height(CoastChatTokens.MetadataSectionGap))
}

private fun compactJson(value: JsonElement): String = value.toString()

private fun statusLabel(status: String): String = when (status) {
    "saved" -> "已保存"
    "save_failed" -> "保存失败"
    "not_returned" -> "未返回"
    "sanitized" -> "已脱敏"
    else -> status.ifBlank { "未返回" }
}
