package com.elementeracoast.app.feature.chat

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.elementeracoast.app.core.model.ChatMessage

@Composable
internal fun EditMessageDialog(
    message: ChatMessage,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit
) {
    var draft by rememberSaveable(message.id) { mutableStateOf(message.text) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑这条消息") },
        text = {
            TextField(
                value = draft,
                onValueChange = { draft = it },
                minLines = 2,
                maxLines = 6,
                placeholder = { Text("写一点什么") }
            )
        },
        confirmButton = {
            TextButton(
                enabled = draft.trim().isNotEmpty(),
                onClick = { onSave(draft) }
            ) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}
