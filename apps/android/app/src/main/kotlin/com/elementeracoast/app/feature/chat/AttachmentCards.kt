package com.elementeracoast.app.feature.chat

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private fun attachmentSizeLabel(value: Long): String = when {
    value < 1024L -> "${value} B"
    value < 1024L * 1024L -> "${(value / 1024.0).let { if (it < 10) "%.1f".format(it) else "%.0f".format(it) }} KB"
    else -> "%.1f MB".format(value / 1024.0 / 1024.0)
}

@Composable
internal fun PendingAttachmentTray(
    conversationId: String,
    attachments: List<ChatAttachment>,
    uploading: Boolean,
    previewSource: AttachmentPreviewRemoteDataSource,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    if (attachments.isEmpty() && !uploading) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        attachments.forEach { attachment ->
            AttachmentCard(
                conversationId = conversationId,
                attachment = attachment,
                previewSource = previewSource,
                removable = true,
                onRemove = { onRemove(attachment.id) }
            )
        }
        if (uploading) {
            SnowLetterSurface(
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .66f),
                fallbackShape = RoundedCornerShape(16.dp)
            ) {
                Text(
                    "正在收好附件…",
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
internal fun MessageAttachmentList(
    conversationId: String,
    attachments: List<ChatAttachment>,
    previewSource: AttachmentPreviewRemoteDataSource,
    modifier: Modifier = Modifier
) {
    if (attachments.isEmpty()) return
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalAlignment = Alignment.End
    ) {
        attachments.forEach { attachment ->
            if (attachment.type == "image") {
                InlineMessageImage(conversationId, attachment, previewSource)
            } else {
                AttachmentCard(
                    conversationId = conversationId,
                    attachment = attachment,
                    previewSource = previewSource
                )
            }
        }
    }
}

/** Full-size image message; unlike pending uploads, sent images are not file cards. */
@Composable
private fun InlineMessageImage(
    conversationId: String,
    attachment: ChatAttachment,
    previewSource: AttachmentPreviewRemoteDataSource
) {
    val state = attachmentPreview(conversationId, attachment, previewSource)
    val preview = state?.getOrNull()
    if (preview != null) {
        val aspect = (preview.width.toFloat() / preview.height.coerceAtLeast(1))
            .coerceIn(0.65f, 2.6f)
        Image(
            bitmap = preview,
            contentDescription = attachment.name,
            modifier = Modifier
                .width(238.dp)
                .aspectRatio(aspect)
                .clip(RoundedCornerShape(18.dp)),
            contentScale = ContentScale.Fit
        )
    } else {
        SnowLetterSurface(
            role = SnowLetterSurfaceRole.StatusCard,
            fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .54f),
            fallbackShape = RoundedCornerShape(17.dp)
        ) {
            Text(
                if (state == null) "正在载入图片…" else "图片暂时无法预览 · ${attachment.name}",
                modifier = Modifier.padding(14.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/** Decode large camera photos at display resolution; keep saved original untouched. */
@Composable
private fun attachmentPreview(
    conversationId: String,
    attachment: ChatAttachment,
    previewSource: AttachmentPreviewRemoteDataSource
): Result<ImageBitmap>? {
    val preview by produceState<Result<ImageBitmap>?>(
        initialValue = null,
        conversationId,
        attachment.id,
        attachment.type
    ) {
        value = if (attachment.type == "image" && conversationId.isNotBlank()) {
            runCatching {
                val bytes = previewSource.get(conversationId, attachment.id)
                withContext(Dispatchers.Default) {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2
                    BitmapFactory.decodeByteArray(
                        bytes, 0, bytes.size,
                        BitmapFactory.Options().apply { inSampleSize = sample }
                    )?.asImageBitmap() ?: error("image_decode_failed")
                }
            }
        } else null
    }
    return preview
}

@Composable
private fun AttachmentCard(
    conversationId: String,
    attachment: ChatAttachment,
    previewSource: AttachmentPreviewRemoteDataSource,
    removable: Boolean = false,
    onRemove: () -> Unit = {}
) {
    val preview = attachmentPreview(conversationId, attachment, previewSource)?.getOrNull()

    SnowLetterSurface(
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .72f),
        fallbackShape = RoundedCornerShape(16.dp)
    ) {
        Row(
            modifier = Modifier.padding(start = 8.dp, end = if (removable) 2.dp else 10.dp, top = 7.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AttachmentVisual(attachment = attachment, preview = preview)
            Spacer(Modifier.size(8.dp))
            Column(modifier = Modifier.padding(end = 6.dp)) {
                Text(
                    attachment.name,
                    maxLines = 1,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    "${attachment.mime.ifBlank { "文件" }} · ${attachmentSizeLabel(attachment.size)}",
                    maxLines = 1,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall
                )
            }
            if (removable) {
                IconButton(onClick = onRemove, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "移除附件", modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun AttachmentVisual(attachment: ChatAttachment, preview: ImageBitmap?) {
    val shape = RoundedCornerShape(11.dp)
    Box(
        modifier = Modifier
            .size(if (attachment.type == "image") 52.dp else 38.dp)
            .clip(shape),
        contentAlignment = Alignment.Center
    ) {
        if (preview != null) {
            Image(
                bitmap = preview,
                contentDescription = attachment.name,
                modifier = Modifier.size(52.dp),
                contentScale = ContentScale.Crop
            )
        } else {
            Icon(
                imageVector = if (attachment.type == "image") Icons.Default.Image else Icons.Default.InsertDriveFile,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(if (attachment.type == "image") 24.dp else 22.dp)
            )
        }
    }
}
