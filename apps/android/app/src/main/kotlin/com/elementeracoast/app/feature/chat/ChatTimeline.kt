package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot
import com.elementeracoast.app.ui.theme.CoastChatTokens
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val CHAT_DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy年M月d日 · EEEE", Locale.SIMPLIFIED_CHINESE)
private val CHAT_TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)

private fun localMessageDateTime(value: String?): java.time.ZonedDateTime? {
    val raw = value?.trim().orEmpty()
    if (raw.isBlank()) return null
    val zone = ZoneId.systemDefault()
    return runCatching { Instant.parse(raw).atZone(zone) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(raw).atZoneSameInstant(zone) }.getOrNull()
        ?: runCatching { LocalDateTime.parse(raw).atZone(zone) }.getOrNull()
}

private fun messageDateKey(value: String?): String =
    localMessageDateTime(value)?.toLocalDate()?.toString().orEmpty()

private fun messageDateLabel(value: String?): String =
    localMessageDateTime(value)?.format(CHAT_DATE_FORMATTER).orEmpty()

private fun messageTimeLabel(value: String?): String =
    localMessageDateTime(value)?.format(CHAT_TIME_FORMATTER).orEmpty()

@Composable
internal fun ChatTimeline(
    conversationId: String,
    messages: List<ChatMessage>,
    thoughtSoil: ThoughtSoilSnapshot?,
    isStreaming: Boolean,
    streamingMessageId: Long?,
    avatarBitmap: ImageBitmap?,
    metadataSource: ModelMetadataRemoteDataSource,
    attachmentPreviewSource: AttachmentPreviewRemoteDataSource,
    onAvatarClick: () -> Unit,
    onCopy: (ChatMessage) -> Unit,
    voiceClips: List<VoiceClip>,
    onVoice: (ChatMessage) -> Unit,
    onPlayVoice: (String) -> Unit,
    onEdit: (ChatMessage) -> Unit,
    onAction: (MessageAction) -> Unit,
    onFootprint: (ChatMessage) -> Unit,
    onOpenActionLog: (Set<String>) -> Unit,
    onOpenThoughtSoil: () -> Unit,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    val streamingIndex = messages.indexOfFirst { it.id == streamingMessageId }
    val streamingLength = messages.getOrNull(streamingIndex)?.text?.length ?: 0
    val latestAssistantIndex = messages.indexOfLast { it.role == MessageRole.Assistant }
    LaunchedEffect(conversationId, messages.size, streamingMessageId, streamingLength, thoughtSoil?.revision) {
        val target = if (streamingIndex >= 0) streamingIndex else messages.lastIndex
        if (target >= 0) listState.scrollToItem(target)
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        if (messages.isEmpty()) {
            Column(modifier = Modifier.align(Alignment.Center).padding(horizontal = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("文字退到页边外。", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("写点什么，新的窗口会从这里长出来。", modifier = Modifier.padding(top = 7.dp), color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .68f))
            }
            return@Box
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().widthIn(max = CoastChatTokens.TimelineMaxWidth),
            contentPadding = PaddingValues(
                start = CoastChatTokens.TimelineHorizontalPadding,
                end = CoastChatTokens.TimelineHorizontalPadding,
                top = CoastChatTokens.TimelineTopPadding,
                bottom = CoastChatTokens.TimelineBottomPadding
            ),
            verticalArrangement = Arrangement.spacedBy(CoastChatTokens.MessageGap)
        ) {
            itemsIndexed(messages, key = { _, message -> message.id }) { index, message ->
                Column {
                    val dateKey = messageDateKey(message.createdAtLabel)
                    val previousDateKey = messages.getOrNull(index - 1)?.let { messageDateKey(it.createdAtLabel) }.orEmpty()
                    if (dateKey.isNotBlank() && dateKey != previousDateKey) {
                        Text(
                            text = messageDateLabel(message.createdAtLabel),
                            modifier = Modifier
                                .align(Alignment.CenterHorizontally)
                                .padding(vertical = 8.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .62f),
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                    val streamingTail = isStreaming && message.id == streamingMessageId
                    val isLatestAssistant = index == latestAssistantIndex && message.role == MessageRole.Assistant
                    val inlineSoil = if (isLatestAssistant) thoughtSoil else null
                    if (message.role == MessageRole.Assistant && !streamingTail && message.furnitureRuns.isNotEmpty()) {
                        FurnitureBubble(
                            runs = message.furnitureRuns,
                            onOpenActionLog = onOpenActionLog,
                            modifier = Modifier.padding(bottom = 5.dp)
                        )
                    }
                    val metadataMessageId = message.remoteVariantId?.takeIf {
                        message.role == MessageRole.Assistant &&
                            !streamingTail &&
                            message.generationSource in setOf("chat", "landing", "radio", "lighthouse") &&
                            it.isNotBlank()
                    }
                    val timeLabel = if (streamingTail) "" else messageTimeLabel(message.createdAtLabel)
                    MessageItem(
                        conversationId = conversationId,
                        message = message,
                        timeLabel = timeLabel,
                        isStreamingTail = streamingTail,
                        avatarBitmap = avatarBitmap,
                        thoughtSoil = inlineSoil,
                        metadataMessageId = metadataMessageId,
                        metadataSource = metadataSource,
                        attachmentPreviewSource = attachmentPreviewSource,
                        onAvatarClick = onAvatarClick,
                        onOpenThoughtSoil = onOpenThoughtSoil,
                        onCopy = onCopy,
                        voiceClips = voiceClips.filter { it.messageId == message.remoteVariantId || (it.messageId.isBlank() && it.turnId == message.turnId) },
                        onVoice = { onVoice(message) },
                        onPlayVoice = onPlayVoice,
                        onEdit = onEdit,
                        onAction = onAction,
                        onFootprint = onFootprint
                    )
                    if (metadataMessageId != null) {
                        ModelUsageFooter(
                            conversationId = conversationId,
                            messageId = metadataMessageId,
                            source = metadataSource,
                            modifier = Modifier.align(Alignment.End).padding(top = 1.dp)
                        )
                    }
                }
            }
        }
    }
}
