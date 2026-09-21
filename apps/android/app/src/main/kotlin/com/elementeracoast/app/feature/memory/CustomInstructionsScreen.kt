package com.elementeracoast.app.feature.memory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.feature.daily.DailyPrimaryButton
import com.elementeracoast.app.feature.daily.DailySurfaceCard
import kotlinx.coroutines.launch

@Composable
internal fun CustomInstructionsScreen(repository: MemoryRepository, onSnackbar: (String) -> Unit) {
    val state by repository.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    val instructions = state.customInstructions
    var draft by remember(instructions.content) { mutableStateOf(instructions.content) }
    LazyColumn(contentPadding = PaddingValues(horizontal = 28.dp, vertical = 16.dp)) {
        item {
            Text("当前自定义指令", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(8.dp))
            DailySurfaceCard {
                BasicTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.fillMaxWidth().height(360.dp),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    decorationBox = { inner ->
                        if (draft.isBlank()) Text("在这里留下单份 active 指令。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        inner()
                    }
                )
            }
            Spacer(Modifier.height(12.dp))
            Text("状态：${instructions.status} · 来源：${instructions.source}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            instructions.updatedAt?.takeIf(String::isNotBlank)?.let {
                Text("最近更新：$it", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(18.dp))
            DailyPrimaryButton("保存当前指令") {
                scope.launch {
                    runCatching { repository.saveInstructions(draft) }
                        .onSuccess { onSnackbar("自定义指令已写回海岸") }
                        .onFailure { onSnackbar(it.message ?: "保存自定义指令失败") }
                }
            }
            Text(
                "清空当前指令",
                modifier = Modifier.fillMaxWidth().clickable {
                    scope.launch {
                        runCatching { repository.saveInstructions("") }
                            .onSuccess {
                                draft = ""
                                onSnackbar("海岸自定义指令已清空")
                            }
                            .onFailure { onSnackbar(it.message ?: "清空自定义指令失败") }
                    }
                }.padding(vertical = 16.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelLarge
            )
        }
    }
}
