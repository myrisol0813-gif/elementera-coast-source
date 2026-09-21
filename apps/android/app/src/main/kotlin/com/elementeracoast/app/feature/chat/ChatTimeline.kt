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
                Text("潮水退到纸页外。", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
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
                    val streamingTail = isStreaming && message.id == streamingMessageId
                    if (message.role == MessageRole.Assistant && !streamingTail && message.furnitureRuns.isNotEmpty()) {
                        FurnitureBubble(
                            runs = message.furnitureRuns,
                            onOpenActionLog = onOpenActionLog,
                            modifier = Modifier.padding(bottom = 5.dp)
                        )
                    }
                    if (index == latestAssistantIndex && thoughtSoil != null) {
                        ThoughtSoilEntry(
                            soil = thoughtSoil,
                            onClick = onOpenThoughtSoil,
                            modifier = Modifier.padding(bottom = 5.dp)
                        )
                    }
                    MessageItem(
                        conversationId = conversationId,
                        message = message,
                        isStreamingTail = streamingTail,
                        avatarBitmap = avatarBitmap,
                        attachmentPreviewSource = attachmentPreviewSource,
                        onAvatarClick = onAvatarClick,
                        onCopy = onCopy,
                        onEdit = onEdit,
                        onAction = onAction,
                        onFootprint = onFootprint
                    )
                    val remoteMessageId = message.remoteVariantId
                    if (
                        message.role == MessageRole.Assistant &&
                        !streamingTail &&
                        message.generationSource in setOf("chat", "landing", "radio", "lighthouse") &&
                        !remoteMessageId.isNullOrBlank()
                    ) {
                        ModelUsageFooter(
                            conversationId = conversationId,
                            messageId = remoteMessageId,
                            source = metadataSource,
                            modifier = Modifier.align(Alignment.End).padding(top = 1.dp)
                        )
                        ModelMetadataTraceCard(
                            conversationId = conversationId,
                            messageId = remoteMessageId,
                            source = metadataSource,
                            modifier = Modifier.padding(
                                start = CoastChatTokens.AssistantAvatarSize + CoastChatTokens.AssistantAvatarGap
                            )
                        )
                    }
                }
            }
        }
    }
}
