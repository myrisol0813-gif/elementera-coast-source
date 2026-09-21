package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole

@Composable
internal fun MessageActionRow(
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, content = content)
}

@Composable
internal fun MessageActionButton(
    icon: ImageVector,
    label: String,
    active: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val tint = when {
        active -> MaterialTheme.colorScheme.primary
        enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .72f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .32f)
    }
    SnowLetterSurface(
        modifier = Modifier
            .size(34.dp)
            .clickable(enabled = enabled, onClick = onClick),
        role = SnowLetterSurfaceRole.ActionButton,
        fallbackColor = if (active) MaterialTheme.colorScheme.primary.copy(alpha = .08f) else Color.Transparent,
        fallbackShape = RoundedCornerShape(9.dp),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = tint,
            modifier = Modifier.size(18.dp)
        )
    }
}