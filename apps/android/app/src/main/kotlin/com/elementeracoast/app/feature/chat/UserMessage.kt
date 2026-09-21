package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.ui.theme.CoastChatTokens
import com.elementeracoast.app.ui.theme.LocalCoastAppearance
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.snowLetterInnerPadding

@Composable
internal fun UserMessage(
    conversationId: String,
    message: ChatMessage,
    attachmentPreviewSource: AttachmentPreviewRemoteDataSource,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onAction: (MessageAction) -> Unit
) {
    if (message.messageSource == "official_mcp") {
        OfficialMcpLetter(
            conversationId = conversationId,
            message = message,
            attachmentPreviewSource = attachmentPreviewSource
        )
        return
    }

    val customBubble = LocalCoastAppearance.current.userBubbleColor
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val maxBubble = maxWidth * CoastChatTokens.UserBubbleWidth
        Row(modifier = Modifier.fillMaxWidth()) {
            Spacer(Modifier.weight(1f))
            Column(modifier = Modifier.widthIn(max = maxBubble), horizontalAlignment = Alignment.End) {
                val bubbleShape = RoundedCornerShape(CoastChatTokens.UserBubbleRadius)
                if (message.text.isNotBlank()) {
                    SnowLetterSurface(
                        role = SnowLetterSurfaceRole.UserBubble,
                        fallbackColor = customBubble ?: MaterialTheme.colorScheme.surfaceVariant,
                        fallbackShape = bubbleShape,
                        fallbackElevation = 2.dp
                    ) {
                        Text(
                            text = message.text,
                            modifier = Modifier
                                .padding(snowLetterInnerPadding(SnowLetterSurfaceRole.UserBubble))
                                .padding(
                                    horizontal = CoastChatTokens.UserBubbleHorizontalPadding,
                                    vertical = CoastChatTokens.UserBubbleVerticalPadding
                                ),
                            color = MaterialTheme.colorScheme.onSurface,
                            style = MaterialTheme.typography.bodyLarge.copy(
                                fontSize = CoastChatTokens.ChatBodySize,
                                lineHeight = CoastChatTokens.UserBodyLineHeight,
                                fontWeight = FontWeight.Normal
                            )
                        )
                    }
                }
                if (message.attachments.isNotEmpty()) {
                    Spacer(Modifier.height(if (message.text.isNotBlank()) 6.dp else 0.dp))
                    MessageAttachmentList(
                        conversationId = conversationId,
                        attachments = message.attachments,
                        previewSource = attachmentPreviewSource
                    )
                }
                if (!message.errorDetail.isNullOrBlank()) {
                    Spacer(Modifier.height(5.dp))
                    Text(
                        "发送未完成 · ${message.errorDetail.substringAfter(':').trim().take(90)}",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Spacer(Modifier.height(CoastChatTokens.UserActionTopGap))
                MessageActionRow {
                    if (!message.errorDetail.isNullOrBlank()) {
                        MessageActionButton(
                            Icons.Default.Refresh,
                            "重试",
                            onClick = { onAction(MessageAction.Retry(message.id)) }
                        )
                    }
                    MessageActionButton(Icons.Default.Edit, "编辑", onClick = onEdit)
                    MessageActionButton(Icons.Default.ContentCopy, "复制", onClick = onCopy)
                    MessageActionButton(
                        Icons.Default.DeleteOutline,
                        if (message.variantCount > 1) "删除当前版本" else "删除消息",
                        onClick = { onAction(MessageAction.Delete(message.id)) }
                    )
                    if (message.variantCount > 1) {
                        Spacer(Modifier.width(CoastChatTokens.VariantActionGap))
                        VariantControl(
                            index = message.variantIndex,
                            count = message.variantCount,
                            onPrevious = { onAction(MessageAction.SelectVariant(message.id, message.variantIndex - 1)) },
                            onNext = { onAction(MessageAction.SelectVariant(message.id, message.variantIndex + 1)) }
                        )
                    }
                }
            }
        }
    }
}
