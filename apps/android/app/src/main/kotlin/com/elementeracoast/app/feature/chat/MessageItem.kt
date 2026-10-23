package com.elementeracoast.app.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.MessageRole

@Composable
internal fun MessageItem(
    conversationId: String,
    message: ChatMessage,
    isStreamingTail: Boolean,
    avatarBitmap: ImageBitmap?,
    metadataMessageId: String?,
    metadataSource: ModelMetadataRemoteDataSource,
    attachmentPreviewSource: AttachmentPreviewRemoteDataSource,
    onAvatarClick: () -> Unit,
    onCopy: (ChatMessage) -> Unit,
    voiceClips: List<VoiceClip>,
    onVoice: (ChatMessage) -> Unit,
    onPlayVoice: (String) -> Unit,
    onEdit: (ChatMessage) -> Unit,
    onAction: (MessageAction) -> Unit,
    onFootprint: (ChatMessage) -> Unit
) {
    when (message.role) {
        MessageRole.User -> UserMessage(
            conversationId = conversationId,
            message = message,
            attachmentPreviewSource = attachmentPreviewSource,
            onCopy = { onCopy(message) },
            onEdit = { onEdit(message) },
            onAction = onAction
        )
        MessageRole.Assistant -> AssistantMessage(
            conversationId = conversationId,
            message = message,
            metadataMessageId = metadataMessageId,
            metadataSource = metadataSource,
            isStreamingTail = isStreamingTail,
            avatarBitmap = avatarBitmap,
            onAvatarClick = onAvatarClick,
            onCopy = { onCopy(message) },
            voiceClips = voiceClips,
            onVoice = { onVoice(message) },
            onPlayVoice = onPlayVoice,
            onAction = onAction,
            onFootprint = { onFootprint(message) }
        )
    }
}
