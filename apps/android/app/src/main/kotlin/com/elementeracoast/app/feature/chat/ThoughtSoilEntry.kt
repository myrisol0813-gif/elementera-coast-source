package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.ThoughtSoilSnapshot

@Composable
internal fun ThoughtSoilEntry(
    soil: ThoughtSoilSnapshot,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 3.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val lock = if (soil.manualLocked) " · 已锁定" else ""
        Text(
            "整理当前对话的纸条 · ${soil.handSeeds.size.coerceAtMost(7)} 粒当前活跃线索$lock",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f))
    }
}
