package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.FurnitureRun

@Composable
internal fun FurnitureBubble(
    runs: List<FurnitureRun>,
    onOpenActionLog: (Set<String>) -> Unit,
    modifier: Modifier = Modifier
) {
    if (runs.isEmpty()) return
    var expanded by remember(runs) { mutableStateOf(false) }
    val loggableIds = runs.map { it.actionId }.filterNot { it.startsWith("runtime:") }.toSet()
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .62f), RoundedCornerShape(16.dp))
            .padding(horizontal = 13.dp, vertical = 10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("本轮工具", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("使用了 ${runs.size} 件工具", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            }
            Icon(Icons.Default.ExpandMore, contentDescription = if (expanded) "收起本轮工具" else "展开本轮工具")
        }
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            runs.forEach { run ->
                val mark = if (run.success) "✓" else "!"
                val suffix = when (run.actionKey) {
                    "memory.search" -> "：${run.count} 条"
                    "web.search" -> "：${run.count} 次"
                    else -> ""
                }
                Text("$mark ${run.label}$suffix", style = MaterialTheme.typography.bodySmall)
                run.items.take(5).forEach { item ->
                    val label = if (item.kind.isBlank()) item.title else "${item.kind}｜${item.title}"
                    Text("  · $label", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (run.extraCount > 0) Text("  · 另有 ${run.extraCount} 条", style = MaterialTheme.typography.labelSmall)
            }
            if (loggableIds.isNotEmpty()) {
                Spacer(Modifier.height(7.dp))
                Text(
                    "查看工具调用记录",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.clickable { onOpenActionLog(loggableIds) }
                )
            }
        }
    }
}
