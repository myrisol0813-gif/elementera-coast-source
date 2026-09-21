package com.elementeracoast.app.feature.serpentdesk

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
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
import com.elementeracoast.app.feature.actionlog.ActionLogScreen
import com.elementeracoast.app.feature.actionlog.ActionLogStore
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole

internal enum class SerpentDeskTool { DevHands, ActionLog }

internal data class SerpentDeskItem(
    val tool: SerpentDeskTool,
    val title: String,
    val subtitle: String
)

internal fun serpentDeskItems(): List<SerpentDeskItem> = listOf(
    SerpentDeskItem(
        tool = SerpentDeskTool.DevHands,
        title = "海岸开发手",
        subtitle = "模型随身工具 · 自检 · 脚印 · 版本 / APK"
    ),
    SerpentDeskItem(
        tool = SerpentDeskTool.ActionLog,
        title = "工具调用记录",
        subtitle = "普通海岸工具调用 · 房间 · 脱敏摘要"
    )
)

@Composable
fun SerpentDeskScreen(
    actionLogStore: ActionLogStore,
    devHands: DevHandsRepository,
    conversationId: String,
    focusIds: Set<String>
) {
    var activeTool by remember(focusIds) {
        mutableStateOf(if (focusIds.isNotEmpty()) SerpentDeskTool.ActionLog else null)
    }

    when (activeTool) {
        SerpentDeskTool.DevHands -> DevHandsScreen(repository = devHands, onBack = { activeTool = null })
        SerpentDeskTool.ActionLog -> ActionLogToolPage(
            store = actionLogStore,
            conversationId = conversationId,
            focusIds = focusIds,
            onBack = { activeTool = null }
        )
        null -> SerpentDeskHome(onOpenTool = { activeTool = it })
    }
}

@Composable
private fun SerpentDeskHome(onOpenTool: (SerpentDeskTool) -> Unit) {
    Column(modifier = Modifier.padding(horizontal = 24.dp, vertical = 24.dp)) {
        Text(
            "模型工作台",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )
        Text(
            "另一位屋主的工作台",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
        )
        Spacer(Modifier.height(18.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            serpentDeskItems().forEach { item -> SerpentDeskItemCard(item, onOpenTool) }
        }
    }
}

@Composable
private fun SerpentDeskItemCard(item: SerpentDeskItem, onOpenTool: (SerpentDeskTool) -> Unit) {
    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenTool(item.tool) },
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    item.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    item.subtitle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp)
            )
        }
    }
}

@Composable
private fun ActionLogToolPage(
    store: ActionLogStore,
    conversationId: String,
    focusIds: Set<String>,
    onBack: () -> Unit
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onBack)
                .padding(horizontal = 24.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回模型工作台",
                modifier = Modifier.size(22.dp)
            )
            Spacer(Modifier.size(8.dp))
            Column {
                Text("工具调用记录", fontWeight = FontWeight.Bold)
                Text(
                    "普通海岸工具调用 · 房间 · 脱敏摘要",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        ActionLogScreen(
            store = store,
            conversationId = conversationId,
            focusIds = focusIds,
            modifier = Modifier.weight(1f)
        )
    }
}
