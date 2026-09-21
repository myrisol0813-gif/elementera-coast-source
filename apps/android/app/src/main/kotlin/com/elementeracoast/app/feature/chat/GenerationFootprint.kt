package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.elementeracoast.app.core.model.ChatMessage

@Composable
internal fun GenerationFootprint(
    message: ChatMessage,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val model = message.modelId ?: return
    val source = message.generationSource?.takeIf { it.isNotBlank() }
    Text(
        text = if (source == null) model else "$model · $source",
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(start = 8.dp, top = 2.dp, bottom = 2.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .52f),
        fontSize = 10.sp,
        maxLines = 1
    )
}
