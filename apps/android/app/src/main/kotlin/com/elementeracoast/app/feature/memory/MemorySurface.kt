package com.elementeracoast.app.feature.memory

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole

enum class MemoryTab(val title: String) {
    Memory("记忆库"),
    Seed("种子库"),
    Worldbook("世界书"),
    GlobalExcerpt("全局摘录"),
    Instructions("自定义指令")
}

enum class MemoryFilterKind(val label: String, val allLabel: String, val emptyLabel: String) {
    Date("日期", "全部日期", "暂无日期"),
    Model("模型", "全部模型", "暂无模型"),
    Window("窗口", "全部窗口", "暂无窗口"),
    Tag("标签", "全部标签", "暂无标签")
}

@Composable
fun MemoryTabs(active: MemoryTab, onSelect: (MemoryTab) -> Unit) {
    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp, vertical = 14.dp),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(7.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                MemoryTabCell(MemoryTab.Memory, active, Modifier.weight(1f), onSelect)
                MemoryTabCell(MemoryTab.Seed, active, Modifier.weight(1f), onSelect)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                MemoryTabCell(MemoryTab.Worldbook, active, Modifier.weight(1f), onSelect)
                MemoryTabCell(MemoryTab.GlobalExcerpt, active, Modifier.weight(1f), onSelect)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                MemoryTabCell(MemoryTab.Instructions, active, Modifier.weight(1f), onSelect)
            }
        }
    }
}

@Composable
private fun MemoryTabCell(tab: MemoryTab, active: MemoryTab, modifier: Modifier, onSelect: (MemoryTab) -> Unit) {
    val selected = tab == active
    Column(
        modifier = modifier
            .background(if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .42f), RoundedCornerShape(16.dp))
            .clickable { onSelect(tab) }
            .padding(vertical = 13.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            tab.title,
            color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun MemoryRetrievalCard(
    query: String,
    onQueryChange: (String) -> Unit,
    filterKind: MemoryFilterKind,
    onFilterKindChange: (MemoryFilterKind) -> Unit,
    filterValue: String,
    values: List<String>,
    onFilterValueChange: (String) -> Unit
) {
    var kindMenu by remember { mutableStateOf(false) }
    var valueMenu by remember { mutableStateOf(false) }

    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 17.dp)
        ) {
            Text("检索", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("搜索", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(6.dp))
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.DogtalkField,
                fallbackColor = MaterialTheme.colorScheme.surface,
                fallbackShape = RoundedCornerShape(17.dp)
            ) {
                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 13.dp),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    decorationBox = { inner ->
                        if (query.isBlank()) Text("搜索标题、核心、使用时机或勿误用", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        inner()
                    }
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.weight(.34f)) {
                    FilterChip(
                        label = filterKind.label,
                        emphasized = true,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { kindMenu = true }
                    )
                    DropdownMenu(expanded = kindMenu, onDismissRequest = { kindMenu = false }) {
                        MemoryFilterKind.entries.forEach { kind ->
                            DropdownMenuItem(
                                text = { Text(kind.label) },
                                onClick = {
                                    kindMenu = false
                                    onFilterKindChange(kind)
                                    onFilterValueChange("")
                                }
                            )
                        }
                    }
                }
                Box(modifier = Modifier.weight(.66f)) {
                    FilterChip(
                        label = filterValue.ifBlank { filterKind.allLabel },
                        emphasized = false,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { valueMenu = true }
                    )
                    DropdownMenu(expanded = valueMenu, onDismissRequest = { valueMenu = false }) {
                        DropdownMenuItem(text = { Text(filterKind.allLabel) }, onClick = { valueMenu = false; onFilterValueChange("") })
                        if (values.isEmpty()) {
                            DropdownMenuItem(
                                text = { Text(filterKind.emptyLabel, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                                onClick = {},
                                enabled = false
                            )
                        } else {
                            values.forEach { value ->
                                DropdownMenuItem(text = { Text(value) }, onClick = { valueMenu = false; onFilterValueChange(value) })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(
    label: String,
    emphasized: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(19.dp)
    val tint = if (emphasized) MaterialTheme.colorScheme.primary.copy(alpha = .10f) else MaterialTheme.colorScheme.surface
    val stroke = if (emphasized) MaterialTheme.colorScheme.primary.copy(alpha = .18f) else MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f)
    Row(
        modifier = modifier
            .heightIn(min = 50.dp)
            .background(tint, shape)
            .border(1.dp, stroke, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Icon(
            Icons.Default.KeyboardArrowDown,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
fun MemoryPendingCard(count: Int, onClick: () -> Unit) {
    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp)
            .clickable(onClick = onClick),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(21.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 17.dp)
        ) {
            Text("待确认区 · $count", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("只有确认后才会进入记忆库或种子库。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}
