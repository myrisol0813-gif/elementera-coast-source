package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.ui.theme.CoastChatTokens
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.snowLetterInnerPadding

@Composable
internal fun AssistantMessage(
    message: ChatMessage,
    isStreamingTail: Boolean,
    avatarBitmap: ImageBitmap?,
    onAvatarClick: () -> Unit,
    onCopy: () -> Unit,
    onAction: (MessageAction) -> Unit,
    onFootprint: () -> Unit
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        AssistantAvatar(avatarBitmap, onAvatarClick)
        Spacer(Modifier.width(CoastChatTokens.AssistantAvatarGap))
        Column(modifier = Modifier.weight(1f)) {
            SnowLetterSurface(
                role = SnowLetterSurfaceRole.AssistantBubble,
                fallbackColor = Color.Transparent,
                fallbackShape = RoundedCornerShape(20.dp)
            ) {
                Column(modifier = Modifier.padding(snowLetterInnerPadding(SnowLetterSurfaceRole.AssistantBubble))) {
                    Text(
                        text = when {
                            message.text.isEmpty() && isStreamingTail -> "•••"
                            isStreamingTail -> message.text + " ▍"
                            else -> message.text
                        },
                        color = MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.bodyLarge.copy(
                            fontSize = CoastChatTokens.ChatBodySize,
                            lineHeight = CoastChatTokens.ChatBodyLineHeight,
                            fontWeight = FontWeight.Normal
                        )
                    )
                    message.errorDetail?.takeIf(String::isNotBlank)?.let { detail ->
                        Spacer(Modifier.height(5.dp))
                        Text(detail, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Spacer(Modifier.height(CoastChatTokens.MessageActionTopGap))
            MessageActionRow {
                MessageActionButton(Icons.Default.ContentCopy, "复制", onClick = onCopy)
                MessageActionButton(Icons.Default.ThumbUp, "点赞", active = message.liked, onClick = { onAction(MessageAction.ToggleLike(message.id)) })
                MessageActionButton(Icons.Default.Refresh, "重新生成", enabled = !isStreamingTail, onClick = { onAction(MessageAction.Regenerate(message.id)) })
                MessageActionButton(Icons.Default.FavoriteBorder, "收藏", active = message.favorite, onClick = { onAction(MessageAction.ToggleFavorite(message.id)) })
                MessageActionButton(Icons.Default.DeleteOutline, "删除", enabled = !isStreamingTail, onClick = { onAction(MessageAction.Delete(message.id)) })
            }
            if (message.variantCount > 1) {
                Spacer(Modifier.height(4.dp))
                Row(modifier = Modifier.align(Alignment.End)) {
                    VariantControl(
                        index = message.variantIndex,
                        count = message.variantCount,
                        onPrevious = { onAction(MessageAction.SelectVariant(message.id, message.variantIndex - 1)) },
                        onNext = { onAction(MessageAction.SelectVariant(message.id, message.variantIndex + 1)) }
                    )
                }
            }
            GenerationFootprint(message, onFootprint, Modifier.align(Alignment.End))
        }
    }
}

@Composable
private fun AssistantAvatar(bitmap: ImageBitmap?, onClick: () -> Unit) {
    val modifier = Modifier.size(CoastChatTokens.AssistantAvatarSize).clip(CircleShape)
        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
        .background(MaterialTheme.colorScheme.surfaceVariant).clickable(onClick = onClick)
    if (bitmap != null) {
        Image(bitmap = bitmap, contentDescription = "更换助手头像", contentScale = ContentScale.Crop, modifier = modifier)
    } else {
        androidx.compose.foundation.layout.Box(modifier = modifier, contentAlignment = Alignment.Center) {
            Text("M", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
    }
}