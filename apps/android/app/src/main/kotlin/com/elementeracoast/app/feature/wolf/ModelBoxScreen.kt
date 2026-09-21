package com.elementeracoast.app.feature.wolf

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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

@Composable
internal fun ModelBoxScreen(
    models: List<String>,
    current: String,
    onSelect: (String) -> Unit,
    onRefresh: () -> Unit
) {
    var expandedModel by remember { mutableStateOf<String?>(null) }
    val grouped = remember(models, current) { groupedUnselectedModels(models, current) }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("模型箱", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "后端模型目录 · 与 PWA 共用当前模型",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Row(
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp))
                        .clickable(onClick = onRefresh)
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null)
                    Text("刷新", style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        item {
            Text("当前模型", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            CurrentModelCard(current)
        }

        item {
            Text("模型目录", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        ModelSeries.entries.forEach { series ->
            item(key = "model-series-${series.name}") {
                Text(
                    series.title,
                    modifier = Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold
                )
            }

            val entries = grouped[series].orEmpty()
            if (entries.isEmpty()) {
                item(key = "model-series-${series.name}-empty") {
                    Text(
                        "暂无目录项",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            } else {
                items(
                    items = entries,
                    key = { item -> "${series.name}:${item.id}" }
                ) { item ->
                    ModelCatalogBubble(
                        item = item,
                        expanded = expandedModel == item.id,
                        onToggle = { expandedModel = if (expandedModel == item.id) null else item.id },
                        onSelect = {
                            onSelect(item.id)
                            expandedModel = null
                        }
                    )
                }
            }
        }

        item {
            Text(
                "刷新读取 /api/models；设为当前后写回共享 profile，PWA 与 Native 会读取同一状态。",
                modifier = Modifier.padding(top = 4.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun CurrentModelCard(model: String) {
    val shape = RoundedCornerShape(18.dp)
    Surface(
        modifier = Modifier.widthIn(min = 190.dp, max = 320.dp),
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 1.dp
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Text(
                model.substringAfterLast('/').ifBlank { "尚未载入" },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                "正在使用",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun ModelCatalogBubble(
    item: LocalModelCatalogItem,
    expanded: Boolean,
    onToggle: () -> Unit,
    onSelect: () -> Unit
) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, shape)
            .clickable(onClick = onToggle)
            .padding(horizontal = 15.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                item.displayName,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(if (expanded) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            Text(item.id, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Text(item.series.title, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Text(
                "目录来源：后端",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(9.dp))
            Text(
                "设为当前",
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = .12f), RoundedCornerShape(13.dp))
                    .clickable(onClick = onSelect)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}
