package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ChatMessage

@Composable
internal fun OfficialMcpLetter(
    conversationId: String,
    message: ChatMessage,
    attachmentPreviewSource: AttachmentPreviewRemoteDataSource
) {
    val paper = Color(0xFFFBF2D8)
    val ink = Color(0xFF493A28)
    val edge = Color(0xFFB89A6A).copy(alpha = .34f)
    val line = Color(0xFF8A704A).copy(alpha = .09f)
    val shape = RoundedCornerShape(topStart = 7.dp, topEnd = 14.dp, bottomStart = 12.dp, bottomEnd = 6.dp)

    Row(modifier = Modifier.fillMaxWidth()) {
        Spacer(Modifier.weight(.07f))
        Column(
            modifier = Modifier
                .weight(.86f)
                .widthIn(max = 620.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(paper, shape)
                    .border(1.dp, edge, shape)
                    .drawBehind {
                        val step = 30.dp.toPx()
                        var y = 48.dp.toPx()
                        while (y < size.height - 8.dp.toPx()) {
                            drawLine(
                                color = line,
                                start = androidx.compose.ui.geometry.Offset(12.dp.toPx(), y),
                                end = androidx.compose.ui.geometry.Offset(size.width - 12.dp.toPx(), y),
                                strokeWidth = 1f
                            )
                            y += step
                        }
                        drawRoundRect(
                            color = Color(0xFFD8BE8C).copy(alpha = .18f),
                            topLeft = androidx.compose.ui.geometry.Offset(size.width - 70.dp.toPx(), 8.dp.toPx()),
                            size = androidx.compose.ui.geometry.Size(46.dp.toPx(), 14.dp.toPx()),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
                            style = Stroke(width = 1f)
                        )
                    }
                    .padding(horizontal = 20.dp, vertical = 18.dp)
            ) {
                Text(
                    "官端来信 · MCP",
                    color = ink.copy(alpha = .62f),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontFamily = FontFamily.Serif,
                        letterSpacing = androidx.compose.ui.unit.TextUnit.Unspecified
                    )
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    message.text,
                    color = ink,
                    style = MaterialTheme.typography.bodyLarge.copy(
                        fontFamily = FontFamily.Cursive,
                        lineHeight = MaterialTheme.typography.bodyLarge.lineHeight * 1.18f,
                        fontWeight = FontWeight.Normal
                    )
                )
                Spacer(Modifier.height(14.dp))
                Text(
                    "— ${message.displayAuthor?.takeIf { it.isNotBlank() } ?: "官端 ChatGPT"}",
                    modifier = Modifier.align(Alignment.End),
                    color = ink.copy(alpha = .72f),
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Serif,
                        fontStyle = FontStyle.Italic
                    )
                )
            }
            if (message.attachments.isNotEmpty()) {
                Spacer(Modifier.height(7.dp))
                MessageAttachmentList(
                    conversationId = conversationId,
                    attachments = message.attachments,
                    previewSource = attachmentPreviewSource
                )
            }
        }
        Spacer(Modifier.weight(.07f))
    }
}
