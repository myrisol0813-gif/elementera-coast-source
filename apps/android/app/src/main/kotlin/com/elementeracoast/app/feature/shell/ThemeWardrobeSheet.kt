package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.CoastThemePreset
import com.elementeracoast.app.ui.theme.SnowLetterVisualSettings
import com.elementeracoast.app.ui.theme.palette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ThemeWardrobeSheet(
    current: CoastThemePreset,
    snowLetterVisuals: SnowLetterVisualSettings = SnowLetterVisualSettings(),
    onSnowLetterVisualsChange: (SnowLetterVisualSettings) -> Unit = {},
    onSelect: (CoastThemePreset) -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
            Text("主题衣柜", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "只换 Native 小身体的衣服。默认主题永远保留。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(12.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(CoastThemePreset.entries, key = { it.name }) { preset ->
                    ThemePresetBubble(
                        preset = preset,
                        selected = preset == current,
                        onClick = {
                            onSelect(preset)
                            if (preset != CoastThemePreset.SnowLetter) onDismiss()
                        }
                    )
                }
                if (current == CoastThemePreset.SnowLetter) {
                    item {
                        SnowLetterDebugPanel(
                            settings = snowLetterVisuals,
                            onChange = onSnowLetterVisualsChange
                        )
                    }
                }
                item { Spacer(Modifier.height(22.dp)) }
            }
        }
    }
}

@Composable
private fun ThemePresetBubble(
    preset: CoastThemePreset,
    selected: Boolean,
    onClick: () -> Unit
) {
    val palette = preset.palette()
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (selected) .92f else .56f),
        tonalElevation = if (selected) 2.dp else 0.dp,
        border = if (selected) BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary)
        else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                ThemeSwatch(palette.background)
                ThemeSwatch(palette.primary)
                ThemeSwatch(palette.accent)
            }
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(preset.label, fontWeight = FontWeight.SemiBold)
                Text(preset.tag, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            Text(
                if (selected) "已穿上" else "换上",
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}

@Composable
private fun SnowLetterDebugPanel(
    settings: SnowLetterVisualSettings,
    onChange: (SnowLetterVisualSettings) -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = .92f),
        tonalElevation = 1.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Text("雪地来信调试", fontWeight = FontWeight.SemiBold)
            Text(
                "只调主聊天衣服透明度，不改按钮、导航和数据。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(10.dp))
            SnowLetterSlider(
                label = "主聊天底图",
                value = settings.chatBackgroundAlpha,
                onValueChange = { onChange(settings.copy(chatBackgroundAlpha = it)) }
            )
            SnowLetterSlider(
                label = "爪印和小动物",
                value = settings.decorationAlpha,
                onValueChange = { onChange(settings.copy(decorationAlpha = it)) }
            )
            SnowLetterSlider(
                label = "皱纸纹理",
                value = settings.paperTextureAlpha,
                onValueChange = { onChange(settings.copy(paperTextureAlpha = it)) }
            )
        }
    }
}

@Composable
private fun SnowLetterSlider(
    label: String,
    value: Float,
    onValueChange: (Float) -> Unit
) {
    val clamped = value.coerceIn(0f, 1f)
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Text("${(clamped * 100).toInt()}%", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        }
        Slider(value = clamped, onValueChange = { onValueChange(it.coerceIn(0f, 1f)) }, valueRange = 0f..1f)
    }
}

@Composable
private fun ThemeSwatch(color: androidx.compose.ui.graphics.Color) {
    Box(
        modifier = Modifier
            .size(20.dp)
            .clip(CircleShape)
            .background(color)
    )
}
