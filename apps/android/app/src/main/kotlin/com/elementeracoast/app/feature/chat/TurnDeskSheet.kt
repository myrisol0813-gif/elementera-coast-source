package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import com.elementeracoast.app.core.model.TurnDeskReceipt
import com.elementeracoast.app.core.model.TurnDeskSection
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import com.elementeracoast.app.ui.theme.snowLetterSheetContainerColor

@Composable
internal fun TurnDeskStatusStrip(
    receipt: TurnDeskReceipt,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    SnowLetterSurface(
        modifier = modifier.fillMaxWidth().clickable(onClick = onClick),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .34f),
        fallbackShape = MaterialTheme.shapes.medium
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    receipt.summary.ifBlank { "本轮递给模型" },
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold
                )
                if (receipt.comfort.isNotBlank()) {
                    Text(
                        receipt.comfort,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TurnDeskBottomSheet(
    receipt: TurnDeskReceipt,
    onDismiss: () -> Unit
) {
    var expanded by remember(receipt) { mutableStateOf<Set<Int>>(emptySet()) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = snowLetterSheetContainerColor()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp)
        ) {
            Text("本轮上下文预览", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                receipt.comfort.ifBlank { "这张回执只描述本轮真正递给模型的上下文。" },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(4.dp))
            receipt.sections.forEachIndexed { index, section ->
                TurnDeskSectionCard(
                    section = section,
                    expanded = index in expanded,
                    onToggle = {
                        expanded = if (index in expanded) expanded - index else expanded + index
                    }
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TurnDeskSectionCard(
    section: TurnDeskSection,
    expanded: Boolean,
    onToggle: () -> Unit
) {
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .46f),
        fallbackShape = MaterialTheme.shapes.large,
        fallbackBorder = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .62f))
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(section.title, fontWeight = FontWeight.SemiBold)
                    Text(
                        section.status.ifBlank { "未递给" },
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(if (expanded) "⌃" else "⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (expanded) {
                HorizontalDivider(
                    modifier = Modifier.padding(top = 10.dp, bottom = 2.dp),
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .52f)
                )
                section.details.filter { it.text.isNotBlank() }.forEach { detail ->
                    if (detail.label.isNotBlank()) {
                        Text(
                            detail.label,
                            modifier = Modifier.padding(top = 9.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Text(
                        detail.text,
                        modifier = Modifier.padding(top = if (detail.label.isBlank()) 8.dp else 2.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}