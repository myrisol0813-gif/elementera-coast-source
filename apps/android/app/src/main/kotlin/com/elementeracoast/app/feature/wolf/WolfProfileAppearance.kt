package com.elementeracoast.app.feature.wolf

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.CoastThemePreset

@Composable
internal fun ProfileScreen(
    state: WolfState,
    store: WolfStore,
    onAppearance: () -> Unit,
    onSnackbar: (String) -> Unit
) {
    var nickname by remember(state.profile.nickname) { mutableStateOf(state.profile.nickname) }
    var signature by remember(state.profile.signature) { mutableStateOf(state.profile.signature) }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        item {
            Text("个人资料", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "这些显示资料不会自动进入 另一位屋主的记忆或系统提示词。真正长期参与理解的内容仍属于自定义指令或记忆库。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
        item { WolfTextField("昵称", nickname, { nickname = it }) }
        item { WolfTextField("聊天署名 / 导出显示名", signature, { signature = it }) }
        item { WolfRow("用户气泡颜色", "复用外观里的同一项设置", onAppearance) }
        item {
            PrimaryLocalButton("保存个人资料") {
                store.saveProfile(nickname, signature)
                onSnackbar("个人资料已保存在本机")
            }
        }
    }
}

@Composable
internal fun AppearanceScreen(state: WolfState, store: WolfStore, onSnackbar: (String) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        item { Text("外观", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        item {
            SettingGroup("主题衣柜") {
                CoastThemePreset.entries.forEach { preset ->
                    ChoiceRow("${preset.label}｜${preset.tag}", state.appearance.theme == preset) {
                        store.setTheme(preset)
                        onSnackbar("主题已切换为${preset.label}")
                    }
                }
            }
        }
        item {
            SettingGroup("用户气泡颜色") {
                listOf("" to "默认 · 跟随主题", "#eaf0f7" to "冷蓝灰", "#f5e8ee" to "浅粉灰", "#f1ead8" to "淡金灰").forEach { (value, label) ->
                    ChoiceRow(label, state.appearance.userBubbleHex == value) { store.setUserBubble(value) }
                }
            }
        }
        item {
            SettingGroup("重点色") {
                listOf("" to "默认 · 跟随主题", "#ff6a21" to "橙色", "#f28b2e" to "金色", "#3b82f6" to "蓝色", "#ec4899" to "粉色").forEach { (value, label) ->
                    ChoiceRow(label, state.appearance.accentHex == value) { store.setAccent(value) }
                }
            }
        }
        item { Text("以上都只保存在本机，不接后端。默认海岸主题不会被覆盖。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
internal fun WolfTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    minLines: Int = 1
) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(5.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp)).padding(13.dp),
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            minLines = minLines,
            maxLines = if (minLines > 1) 8 else 1
        )
    }
}

@Composable
internal fun SettingGroup(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(22.dp)).padding(16.dp)
    ) {
        Text(title, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
internal fun ChoiceRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp)) {
        Text(if (selected) "●" else "○", color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.padding(horizontal = 5.dp))
        Text(label, modifier = Modifier.weight(1f))
    }
}

@Composable
internal fun PrimaryLocalButton(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primary, RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(14.dp),
        color = MaterialTheme.colorScheme.onPrimary,
        fontWeight = FontWeight.SemiBold
    )
}
