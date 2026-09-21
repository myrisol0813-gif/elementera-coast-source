package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun VariantControl(
    index: Int,
    count: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit
) {
    if (count <= 1) return
    val safeCount = count.coerceAtLeast(1)
    val safeIndex = index.coerceIn(0, safeCount - 1)
    Row(verticalAlignment = Alignment.CenterVertically) {
        VariantArrow(previous = true, enabled = safeIndex > 0, onClick = onPrevious)
        Spacer(Modifier.width(5.dp))
        Text(
            text = "$safeCount/${safeIndex + 1}",
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f),
            fontSize = 12.sp
        )
        Spacer(Modifier.width(5.dp))
        VariantArrow(previous = false, enabled = safeIndex < safeCount - 1, onClick = onNext)
    }
}

@Composable
private fun VariantArrow(previous: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val tint = if (enabled) MaterialTheme.colorScheme.onSurface.copy(alpha = .72f)
    else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .24f)
    Box(
        modifier = Modifier
            .size(28.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = if (previous) Icons.AutoMirrored.Filled.KeyboardArrowLeft
            else Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = if (previous) "上一个版本" else "下一个版本",
            tint = tint,
            modifier = Modifier.size(17.dp)
        )
    }
}
