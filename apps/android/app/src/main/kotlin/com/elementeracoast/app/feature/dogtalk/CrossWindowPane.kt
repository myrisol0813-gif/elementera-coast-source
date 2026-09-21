package com.elementeracoast.app.feature.dogtalk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.CrossWindowMessage
import com.elementeracoast.app.core.model.CrossWindowMode
import com.elementeracoast.app.core.model.CrossWindowSource
import com.elementeracoast.app.core.model.CrossWindowTurn
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.ui.theme.CoastChatTokens
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.coastDogtalkFieldColor

private const val CrossWindowDescription = "这是本轮从其他海岸窗口取来的旧信索引；手动选择只在本轮有效。"

@Composable
fun CrossWindowPane(
    conversationId: String,
    repository: CrossWindowRepository,
    state: CrossWindowUiState,
    onChange: (CrossWindowUiState) -> Unit,
    onNotice: (String) -> Unit,
    keywordOnly: Boolean = false,
    modifier: Modifier = Modifier
) {
    val latestState by rememberUpdatedState(state)
    val fieldColor = coastDogtalkFieldColor()

    LaunchedEffect(conversationId, keywordOnly) {
        if (conversationId.isBlank() || keywordOnly) return@LaunchedEffect
        onChange(latestState.copy(loading = true, error = null))
        try {
            val snapshot = repository.sources(conversationId)
            onChange(latestState.withSnapshot(snapshot.description, snapshot.limits, snapshot.sources))
        } catch (error: CoastApiException) {
            onChange(latestState.copy(loading = false, error = error.message))
        } catch (_: Throwable) {
            onChange(latestState.copy(loading = false, error = "跨窗口旧信索引读取失败。"))
        }
    }

    Column(modifier = modifier.fillMaxWidth()) {
        if (keywordOnly) {
            Text("本地旧信关键词", fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            CrossWindowNote("只检索海岸跨窗口历史，不会搜索互联网。模型先看最多约 10 条短摘录，再挑 1–3 条完整旧消息精读。")
            Spacer(Modifier.height(10.dp))
            val active = state.mode == CrossWindowMode.Keyword
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = .12f) else fieldColor, RoundedCornerShape(14.dp))
                    .clickable { onChange(state.copy(mode = if (active) CrossWindowMode.Off else CrossWindowMode.Keyword)) }
                    .padding(horizontal = 13.dp, vertical = 11.dp)
            ) {
                Text(if (active) "本轮已允许模型翻本地旧信" else "本轮允许模型翻本地旧信", fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(6.dp))
            CrossWindowNote("无命中时会明确显示“本地旧信无命中”；本模式不会递给模型 web search 工具。")
            return@Column
        }

        Text(CrossWindowDescription, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(CrossWindowMode.Off, CrossWindowMode.Manual, CrossWindowMode.ModelDecides).forEach { mode ->
                ModeChip(mode, state.mode == mode, { onChange(state.copy(mode = mode)) }, Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            "窗口默认收起；点窗口展开轮次，点轮次再选择单条 user / assistant 消息。",
            modifier = Modifier.fillMaxWidth().background(fieldColor, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 7.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f),
            style = MaterialTheme.typography.labelSmall
        )
        Spacer(Modifier.height(8.dp))
        when (state.mode) {
            CrossWindowMode.Off, CrossWindowMode.Keyword -> CrossWindowNote("本轮关闭跨窗口原文读取。")
            CrossWindowMode.ModelDecides -> CrossWindowNote("本轮只开放取信工具，不提前塞入其他窗口正文。模型没有调用时，不会读取。")
            CrossWindowMode.Manual -> ManualSources(state, onChange)
        }
        if (state.loading) {
            Spacer(Modifier.height(7.dp))
            CrossWindowNote("正在整理跨窗口旧信索引……")
        }
        state.error?.takeIf(String::isNotBlank)?.let {
            Spacer(Modifier.height(7.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun ModeChip(mode: CrossWindowMode, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.background(
            if (selected) MaterialTheme.colorScheme.primary.copy(alpha = .12f) else coastDogtalkFieldColor(),
            RoundedCornerShape(999.dp)
        ).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(mode.label, style = MaterialTheme.typography.labelSmall, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium)
    }
}

@Composable
private fun ManualSources(state: CrossWindowUiState, onChange: (CrossWindowUiState) -> Unit) {
    if (!state.loading && state.sources.isEmpty()) {
        CrossWindowNote("现在没有其他可读取窗口。")
        return
    }
    Text("已选 ${state.selectedMessages.size} 条消息", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
    Spacer(Modifier.height(6.dp))
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        state.sources.forEach { source -> SourceCard(source, state, onChange) }
    }
}

@Composable
private fun SourceCard(source: CrossWindowSource, state: CrossWindowUiState, onChange: (CrossWindowUiState) -> Unit) {
    val open = state.isSourceExpanded(source.conversationId)
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth().alpha(if (source.readable) 1f else .58f),
        role = SnowLetterSurfaceRole.DogtalkField,
        fallbackColor = coastDogtalkFieldColor(),
        fallbackShape = RoundedCornerShape(13.dp)
    ) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier.fillMaxWidth().clickable(enabled = source.readable) { onChange(state.toggleSource(source.conversationId)) }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(sourceDisplayName(source), fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        buildString {
                            append(sourceKind(source))
                            source.updatedAt?.takeIf(String::isNotBlank)?.let { append(" · "); append(compactTime(it)) }
                            append(" · "); append(if (source.readable) "${source.turnCount}轮" else source.disabledReason.ifBlank { "不可读取" })
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                Text(if (open) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (open) {
                Column(Modifier.padding(start = 7.dp, end = 7.dp, bottom = 7.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    source.turns.forEach { turn -> TurnCard(source, turn, state, onChange) }
                }
            }
        }
    }
}

@Composable
private fun TurnCard(source: CrossWindowSource, turn: CrossWindowTurn, state: CrossWindowUiState, onChange: (CrossWindowUiState) -> Unit) {
    val open = state.isTurnExpanded(source.conversationId, turn.turnId)
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface.copy(alpha = .45f), RoundedCornerShape(11.dp))) {
        Row(
            Modifier.fillMaxWidth().clickable { onChange(state.toggleTurn(source.conversationId, turn.turnId)) }.padding(horizontal = 9.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("轮次 ${turn.turnNumber}", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
            Text("${turn.messages.size} 条 · ${if (open) "⌃" else "⌄"}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        }
        if (open) {
            turn.messages.forEach { message -> MessageRow(source, message, state, onChange) }
        }
    }
}

@Composable
private fun MessageRow(source: CrossWindowSource, message: CrossWindowMessage, state: CrossWindowUiState, onChange: (CrossWindowUiState) -> Unit) {
    val checked = state.isMessageSelected(source.conversationId, message.messageId)
    Row(
        Modifier.fillMaxWidth().clickable { onChange(state.toggleMessage(source.conversationId, message.messageId)) }.padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.Top
    ) {
        Box(
            Modifier.size(21.dp).background(
                if (checked) MaterialTheme.colorScheme.primary.copy(alpha = .86f) else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(7.dp)
            ),
            contentAlignment = Alignment.Center
        ) {
            if (checked) Icon(Icons.Default.Check, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(13.dp))
        }
        Spacer(Modifier.size(8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "${message.role} · ${message.displayAuthor.ifBlank { message.role }}",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                listOfNotNull(message.createdAt?.let(::compactTime), message.length.takeIf { it > 0 }?.let { "$it 字符" }).joinToString(" · "),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall
            )
            Text(message.preview.ifBlank { "（空）" }, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun CrossWindowNote(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f), style = MaterialTheme.typography.labelSmall.copy(fontSize = CoastChatTokens.DogtalkMetaSize))
}

private fun sourceDisplayName(source: CrossWindowSource): String =
    if (source.source == "rikkahub") "【Rikka】${source.title}" else source.title

private fun sourceKind(source: CrossWindowSource): String = when {
    source.source == "rikkahub" -> "RikkaHub"
    source.roomType == "radio" -> "电波"
    source.roomType == "lighthouse" -> "灯塔"
    else -> "主聊天"
}

private fun compactTime(value: String): String = value.replace('T', ' ').take(16)
