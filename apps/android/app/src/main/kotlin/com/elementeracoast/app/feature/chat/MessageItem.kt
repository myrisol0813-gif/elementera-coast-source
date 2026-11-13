package com.elementeracoast.app.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.MessageAction
import com.elementeracoast.app.core.model.MessageRole
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot

@Composable
internal fun MessageItem(
    conversationId: String,
    message: ChatMessage,
    timeLabel: String,
    isStreamingTail: Boolean,
    avatarBitmap: ImageBitmap?,
    thoughtSoil: ThoughtSoilSnapshot?,
    metadataMessageId: String?,
    metadataSource: ModelMetadataRemoteDataSource,
    attachmentPreviewSource: AttachmentPreviewRemoteDataSource,
    onAvatarClick: () -> Unit,
    onOpenThoughtSoil: () -> Unit,
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
            timeLabel = timeLabel,
            attachmentPreviewSource = attachmentPreviewSource,
            onCopy = { onCopy(message) },
            onEdit = { onEdit(message) },
            onAction = onAction
        )
        MessageRole.Assistant -> AssistantMessage(
            conversationId = conversationId,
            message = message,
            timeLabel = timeLabel,
            metadataMessageId = metadataMessageId,
            metadataSource = metadataSource,
            isStreamingTail = isStreamingTail,
            avatarBitmap = avatarBitmap,
            thoughtSoil = thoughtSoil,
            onAvatarClick = onAvatarClick,
            onOpenThoughtSoil = onOpenThoughtSoil,
            onCopy = { onCopy(message) },
            voiceClips = voiceClips,
            onVoice = { onVoice(message) },
            onPlayVoice = onPlayVoice,
            onAction = onAction,
            onFootprint = { onFootprint(message) }
        )
    }
}
