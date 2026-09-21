package com.elementeracoast.app.feature.chat

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

@Composable
internal fun AvatarPickerDialog(
    onDismiss: () -> Unit,
    onUploadLater: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("另一位屋主头像") },
        text = {
            Text("当前头像从后端 profile 读取。上传写回不在本轮范围内，因此这里不会只改本机、也不会伪装成已同步。")
        },
        confirmButton = {
            TextButton(onClick = onUploadLater) { Text("上传接线后启用") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        }
    )
}
