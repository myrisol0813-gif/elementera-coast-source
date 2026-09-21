package com.elementeracoast.app.feature.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import com.elementeracoast.app.core.model.ConversationSummary
import com.elementeracoast.app.ui.theme.CoastChatTokens

@Composable
internal fun ConversationActionsButton(
    conversation: ConversationSummary,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var menuOpen by rememberSaveable(conversation.id) { mutableStateOf(false) }
    var renameOpen by rememberSaveable(conversation.id) { mutableStateOf(false) }
    Box(modifier = modifier) {
        IconButton(onClick = { menuOpen = true }) {
            Icon(
                Icons.Default.MoreHoriz,
                "窗口操作",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(CoastChatTokens.ConversationMoreGlyph)
            )
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("改名") },
                onClick = { menuOpen = false; renameOpen = true }
            )
            DropdownMenuItem(
                text = { Text("删除", color = MaterialTheme.colorScheme.error) },
                onClick = {
                    menuOpen = false
                    onDelete(conversation.id)
                }
            )
        }
    }
    if (renameOpen) {
        RenameConversationDialog(
            conversation = conversation,
            onDismiss = { renameOpen = false }
        ) { title ->
            onRename(conversation.id, title)
            renameOpen = false
        }
    }
}

@Composable
private fun RenameConversationDialog(
    conversation: ConversationSummary,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var draft by rememberSaveable(conversation.id) {
        mutableStateOf(conversation.title.removePrefix(conversation.roomType.titlePrefix).trim())
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                "窗口改名",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
        },
        text = {
            TextField(
                value = draft,
                onValueChange = { draft = it },
                singleLine = true,
                placeholder = { Text("输入窗口标题") }
            )
        },
        confirmButton = {
            TextButton(
                enabled = draft.trim().isNotEmpty(),
                onClick = { onConfirm(draft) }
            ) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}
