package com.elementeracoast.app.feature.actionlog

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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun ActionLogScreen(
    store: ActionLogStore,
    conversationId: String,
    focusIds: Set<String>,
    modifier: Modifier = Modifier
) {
    val records by store.records.collectAsState()
    var status by remember { mutableStateOf<LocalActionStatus?>(null) }
    var actionKey by remember { mutableStateOf("") }
    var conversationFilter by remember(focusIds, conversationId) {
        mutableStateOf(if (focusIds.isNotEmpty()) conversationId else "")
    }
    val filter = ActionLogFilter(
        status = status,
        actionKey = actionKey,
        conversationId = conversationFilter,
        actionIds = focusIds
    )
    val visible = store.filtered(filter)

    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("工具透明层", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(8.dp))
            FilterRow(
                status = status,
                actionKey = actionKey,
                conversationId = conversationFilter,
                keys = records.map { it.actionKey }.distinct(),
                conversations = records.map { it.conversationId }.distinct(),
                onStatus = { status = it },
                onActionKey = { actionKey = it },
                onConversation = { if (focusIds.isEmpty()) conversationFilter = it }
            )
            if (focusIds.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("来自本轮工具 · ${focusIds.size} 个 action id", color = MaterialTheme.colorScheme.primary)
            }
        }
        if (visible.isEmpty()) {
            item {
                QuietCard { Text("当前筛选下还没有家具行动记录。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        } else {
            items(visible, key = { it.actionId }) { record -> ActionRow(record) }
        }
    }
}

@Composable
private fun FilterRow(
    status: LocalActionStatus?,
    actionKey: String,
    conversationId: String,
    keys: List<String>,
    conversations: List<String>,
    onStatus: (LocalActionStatus?) -> Unit,
    onActionKey: (String) -> Unit,
    onConversation: (String) -> Unit
) {
    var statusOpen by remember { mutableStateOf(false) }
    var keyOpen by remember { mutableStateOf(false) }
    var conversationOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column {
                FilterChip(if (status == null) "全部状态" else status.name.lowercase()) { statusOpen = true }
                DropdownMenu(statusOpen, onDismissRequest = { statusOpen = false }) {
                    DropdownMenuItem(text = { Text("全部状态") }, onClick = { onStatus(null); statusOpen = false })
                    LocalActionStatus.entries.forEach { value ->
                        DropdownMenuItem(text = { Text(value.name.lowercase()) }, onClick = { onStatus(value); statusOpen = false })
                    }
                }
            }
            Column {
                FilterChip(if (actionKey.isBlank()) "全部类型" else actionKey) { keyOpen = true }
                DropdownMenu(keyOpen, onDismissRequest = { keyOpen = false }) {
                    DropdownMenuItem(text = { Text("全部类型") }, onClick = { onActionKey(""); keyOpen = false })
                    keys.forEach { key ->
                        DropdownMenuItem(text = { Text(key) }, onClick = { onActionKey(key); keyOpen = false })
                    }
                }
            }
        }
        Column {
            FilterChip(if (conversationId.isBlank()) "全部 conversation" else conversationId) { conversationOpen = true }
            DropdownMenu(conversationOpen, onDismissRequest = { conversationOpen = false }) {
                DropdownMenuItem(text = { Text("全部 conversation") }, onClick = { onConversation(""); conversationOpen = false })
                conversations.forEach { id ->
                    DropdownMenuItem(text = { Text(id) }, onClick = { onConversation(id); conversationOpen = false })
                }
            }
        }
    }
}

@Composable
private fun FilterChip(text: String, onClick: () -> Unit) {
    Text(
        text,
        modifier = Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        style = MaterialTheme.typography.labelLarge
    )
}

@Composable
private fun ActionRow(record: LocalActionRecord) {
    var open by remember(record.actionId) { mutableStateOf(false) }
    QuietCard {
        Column(modifier = Modifier.fillMaxWidth().clickable { open = !open }) {
            Row(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(record.label, fontWeight = FontWeight.SemiBold)
                    Text("${record.roomType.wireValue} · ${record.conversationId}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                }
                Text(record.status.name.lowercase(), color = if (record.status == LocalActionStatus.Success) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
            }
            if (open) {
                Spacer(Modifier.height(10.dp))
                Detail("action_id", record.actionId)
                Detail("action_key", record.actionKey)
                Detail("创建", record.createdAt)
                Detail("完成", record.finishedAt)
                Detail("脱敏 input", record.inputSummary.ifBlank { "—" })
                Detail("脱敏 output", record.outputSummary.ifBlank { "—" })
                if (record.errorMessage.isNotBlank()) Detail("错误", record.errorMessage)
            }
        }
    }
}

@Composable
private fun Detail(label: String, value: String) {
    Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(value, style = MaterialTheme.typography.bodySmall)
    Spacer(Modifier.height(5.dp))
}

@Composable
private fun QuietCard(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(22.dp))
            .padding(horizontal = 18.dp, vertical = 17.dp)
    ) { content() }
}
