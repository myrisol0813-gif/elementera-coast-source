package com.elementeracoast.app.feature.chat

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ToolActivityNotice(
    val id: String,
    val text: String,
    val success: Boolean = true
)

object ToolActivityBus {
    private val _notice = MutableStateFlow<ToolActivityNotice?>(null)
    val notice = _notice.asStateFlow()

    fun publish(id: String, text: String, success: Boolean = true) {
        val cleanId = id.trim()
        val cleanText = text.trim()
        if (cleanId.isBlank() || cleanText.isBlank()) return
        _notice.value = ToolActivityNotice(cleanId, cleanText, success)
    }

    fun clear(id: String) {
        if (_notice.value?.id == id) _notice.value = null
    }
}

internal fun friendlyToolActivity(name: String, success: Boolean): String {
    val label = when (name.trim()) {
        "memory_search" -> "搜索记忆"
        "memory_write_candidate" -> "放入待确认区"
        "read_mystic_dogtalk" -> "读取私人草稿"
        "create_moment" -> "写碳硅圈"
        "create_diary" -> "写日记"
        "moment_comment" -> "评论碳硅圈"
        "moment_like" -> "调整碳硅圈点赞"
        "cross_window_read_recent", "cross_window_search" -> "跨窗口读取"
        else -> name.replace('_', ' ').ifBlank { "前端工具" }
    }
    return if (success) "使用工具 · $label" else "工具没有摆好 · $label"
}

@Composable
internal fun ToolActivityPopup(notice: ToolActivityNotice, modifier: Modifier = Modifier) {
    SnowLetterSurface(
        modifier = modifier,
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .78f),
        fallbackShape = RoundedCornerShape(18.dp),
        fallbackElevation = 2.dp
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.AutoAwesome,
                contentDescription = null,
                tint = if (notice.success) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                modifier = Modifier.size(17.dp)
            )
            Spacer(Modifier.size(7.dp))
            Text(
                notice.text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
