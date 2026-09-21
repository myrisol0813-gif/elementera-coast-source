/*
 * The multiline composer and send/stop-in-one-place interaction keep the
 * selected MIT-licensed MiniiChat-derived interaction pattern from the PoC.
 * Coast-specific three-part composer geometry is rewritten from the PWA visual
 * reference supplied for Native v1. See THIRD_PARTY_NOTICES.md.
 */
package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import com.elementeracoast.app.core.model.ChatAttachment
import com.elementeracoast.app.ui.theme.CoastChatTokens
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.snowLetterComposerGlyphColor

@Composable
fun CoastComposer(
    conversationId: String,
    value: String,
    onValueChange: (String) -> Unit,
    pendingAttachments: List<ChatAttachment>,
    attachmentUploading: Boolean,
    previewSource: AttachmentPreviewRemoteDataSource,
    isStreaming: Boolean,
    enabled: Boolean = true,
    onPickImage: () -> Unit,
    onPickFile: () -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onPlaceholder: (String) -> Unit
) {
    val focus = LocalFocusManager.current
    var attachmentMenuOpen by remember { mutableStateOf(false) }
    val canSend = enabled &&
        (value.trim().isNotEmpty() || pendingAttachments.isNotEmpty()) &&
        !attachmentUploading &&
        !isStreaming
    val plusGlyphColor = snowLetterComposerGlyphColor(MaterialTheme.colorScheme.onSurface)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding()
    ) {
        PendingAttachmentTray(
            conversationId = conversationId,
            attachments = pendingAttachments,
            uploading = attachmentUploading,
            previewSource = previewSource,
            onRemove = onRemoveAttachment
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = CoastChatTokens.ComposerHorizontalPadding,
                    vertical = CoastChatTokens.ComposerVerticalPadding
                ),
            verticalAlignment = Alignment.Bottom
        ) {
            Box {
                RoundComposerButton(
                    background = MaterialTheme.colorScheme.surfaceVariant,
                    foreground = plusGlyphColor,
                    enabled = enabled && !isStreaming && !attachmentUploading,
                    onClick = { attachmentMenuOpen = true }
                ) {
                    Icon(
                        Icons.Default.Add,
                        contentDescription = "添加图片或文件",
                        modifier = Modifier.size(CoastChatTokens.ComposerPlusGlyph)
                    )
                }
                DropdownMenu(
                    expanded = attachmentMenuOpen,
                    onDismissRequest = { attachmentMenuOpen = false }
                ) {
                    DropdownMenuItem(
                        text = {
                            AttachmentMenuText(
                                title = "图片",
                                subtitle = "PNG / JPG / WEBP · 单个 ≤ 8 MB · 需识图模型"
                            )
                        },
                        leadingIcon = { Icon(Icons.Default.Image, contentDescription = null) },
                        onClick = {
                            attachmentMenuOpen = false
                            onPickImage()
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            AttachmentMenuText(
                                title = "文件",
                                subtitle = "TXT / MD / JSON / CSV / YAML / 代码 / 日志等\n可上传 ≤ 8 MB · 可读文本 ≤ 1 MB · PDF 暂不解析"
                            )
                        },
                        leadingIcon = { Icon(Icons.Default.InsertDriveFile, contentDescription = null) },
                        onClick = {
                            attachmentMenuOpen = false
                            onPickFile()
                        }
                    )
                }
            }

            Spacer(Modifier.size(CoastChatTokens.ComposerGap))

            SnowLetterSurface(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(
                        min = CoastChatTokens.ComposerPillMinHeight,
                        max = CoastChatTokens.ComposerPillMaxHeight
                    ),
                role = SnowLetterSurfaceRole.ComposerField,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(CoastChatTokens.ComposerPillRadius)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(
                            start = CoastChatTokens.ComposerPillStartPadding,
                            end = CoastChatTokens.ComposerPillEndPadding,
                            top = CoastChatTokens.ComposerPillVerticalPadding,
                            bottom = CoastChatTokens.ComposerPillVerticalPadding
                        ),
                    verticalAlignment = Alignment.Bottom
                ) {
                    Box(
                        modifier = Modifier.weight(1f).heightIn(min = CoastChatTokens.ComposerMicTouch),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        if (value.isEmpty()) {
                            Text(
                                if (enabled) "询问任何问题" else "正在准备聊天…",
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .8f),
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontSize = CoastChatTokens.ComposerTextSize,
                                    lineHeight = CoastChatTokens.ComposerTextLineHeight
                                )
                            )
                        }
                        BasicTextField(
                            value = value,
                            onValueChange = onValueChange,
                            enabled = enabled && !isStreaming && !attachmentUploading,
                            modifier = Modifier.fillMaxWidth(),
                            textStyle = MaterialTheme.typography.bodyMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface,
                                fontSize = CoastChatTokens.ComposerTextSize,
                                lineHeight = CoastChatTokens.ComposerTextLineHeight
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            maxLines = 6
                        )
                    }
                    if (value.isBlank() && pendingAttachments.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .size(CoastChatTokens.ComposerMicTouch)
                                .clickable(enabled = enabled && !isStreaming) {
                                    onPlaceholder("语音输入不在 V1 范围内。")
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Default.Mic,
                                contentDescription = "语音输入",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .78f),
                                modifier = Modifier.size(CoastChatTokens.ComposerMicGlyph)
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.size(CoastChatTokens.ComposerGap))

            val actionBackground = if (isStreaming) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.primary
            val actionForeground = snowLetterComposerGlyphColor(
                if (isStreaming) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onPrimary
            )
            RoundComposerButton(
                background = actionBackground,
                foreground = actionForeground,
                enabled = (enabled && !attachmentUploading) || isStreaming,
                onClick = {
                    when {
                        isStreaming -> onStop()
                        canSend -> {
                            focus.clearFocus()
                            onSend()
                        }
                        else -> onPlaceholder("空输入通话不在 Native V1 范围内。")
                    }
                }
            ) {
                Icon(
                    imageVector = when {
                        isStreaming -> Icons.Default.Stop
                        canSend -> Icons.Default.ArrowUpward
                        else -> Icons.Default.Call
                    },
                    contentDescription = when {
                        isStreaming -> "停止"
                        canSend -> "发送"
                        else -> "通话"
                    },
                    modifier = Modifier.size(CoastChatTokens.ComposerActionGlyph)
                )
            }
        }
    }
}

@Composable
private fun AttachmentMenuText(title: String, subtitle: String) {
    Column {
        Text(title, style = MaterialTheme.typography.bodyMedium)
        Text(
            subtitle,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .76f),
            style = MaterialTheme.typography.labelSmall
        )
    }
}

@Composable
private fun RoundComposerButton(
    background: Color,
    foreground: Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
    content: @Composable () -> Unit
) {
    Box(
        modifier = Modifier
            .size(CoastChatTokens.ComposerTouchTarget)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        SnowLetterSurface(
            modifier = Modifier.size(CoastChatTokens.ComposerVisualButton),
            role = SnowLetterSurfaceRole.ComposerButton,
            fallbackColor = background,
            fallbackShape = CircleShape,
            contentAlignment = Alignment.Center
        ) {
            CompositionLocalProvider(
                androidx.compose.material3.LocalContentColor provides foreground,
                content = content
            )
        }
    }
}
