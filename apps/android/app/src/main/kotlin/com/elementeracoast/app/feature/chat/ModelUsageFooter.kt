package com.elementeracoast.app.feature.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import com.elementeracoast.app.ui.theme.CoastChatTokens
import java.text.NumberFormat

@Composable
internal fun ModelUsageFooter(
    conversationId: String,
    messageId: String,
    source: ModelMetadataRemoteDataSource,
    modifier: Modifier = Modifier
) {
    var totalTokens by remember(messageId) { mutableStateOf<Long?>(null) }
    LaunchedEffect(conversationId, messageId) {
        totalTokens = runCatching { source.get(conversationId, messageId, includeRaw = false) }
  .getOrNull()
  ?.metadata
  ?.usage
  ?.let { usage ->
      usage.totalTokens ?: listOfNotNull(usage.promptTokens, usage.completionTokens).takeIf { it.isNotEmpty() }?.sum()
  }
    }
    val total = totalTokens ?: return
    Text(
        text = "${NumberFormat.getIntegerInstance().format(total)} tokens",
        modifier = modifier,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .62f),
        style = MaterialTheme.typography.labelSmall.copy(
  fontSize = CoastChatTokens.MetadataTitleSize,
  fontWeight = FontWeight.Normal
        )
    )
}
