package com.elementeracoast.app.feature.letters

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.model.modelDisplayName
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.feature.shell.FeaturePageTopBar
import kotlinx.coroutines.launch

@Composable
fun IslandLetterScreen(
    store: IslandLetterStore,
    conversationId: String,
    modelName: String,
    recentTurns: Int,
    contextBudget: Int,
    onBack: () -> Unit,
    onRefreshCoast: () -> Unit,
    onSnackbar: (String) -> Unit
) {
    val context = LocalContext.current
    val remote = remember(context) { IslandLetterRemoteDataSource.production(context) }
    val scope = rememberCoroutineScope()
    var text by remember(conversationId, modelName) {
        mutableStateOf(store.read(conversationId, modelName))
    }
    var sending by remember(conversationId, modelName) { mutableStateOf(false) }
    var status by remember(conversationId, modelName) { mutableStateOf("") }
    var reply by remember(conversationId, modelName) { mutableStateOf("") }
    var replyModel by remember(conversationId, modelName) { mutableStateOf("") }

    fun sendLetter() {
        if (sending) return
        val clean = text.trim()
        if (clean.isBlank()) {
            status = "登岛信还是空的"
            onSnackbar(status)
            return
        }
        text = store.save(conversationId, modelName, text)
        sending = true
        status = "正在递信……"
        reply = ""
        replyModel = ""
        scope.launch {
            try {
                val receipt = remote.send(conversationId, modelName, text, recentTurns, contextBudget)
                reply = receipt.reply
                replyModel = receipt.model
                status = "已送达"
                onRefreshCoast()
                onSnackbar("登岛信已送达")
            } catch (error: Throwable) {
                val message = when (error) {
                    is CoastApiException -> error.message
                    else -> error.message ?: "递信失败，请稍后再试"
                }
                status = if (message.contains("登录")) "需要先登录" else "递信失败：$message"
                onSnackbar(status)
            } finally {
                sending = false
            }
        }
    }

    Column {
        FeaturePageTopBar(
            title = "登岛信",
            subtitle = "$modelName · 当前窗口",
            onBack = onBack
        )
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 28.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(20.dp))
                        .padding(15.dp)
                ) {
                    Text("一封给当前模型的入住信", fontWeight = FontWeight.Bold)
                    Text(
                        "草稿按当前窗口与模型保存在本机；递出时会交给后端，并把真实回复写回当前聊天窗口。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            item {
                BasicTextField(
                    value = text,
                    onValueChange = { text = it.take(IslandLetterStore.MAX_LENGTH) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 420.dp)
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(22.dp))
                        .padding(horizontal = 18.dp, vertical = 18.dp),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary)
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    LetterButton(if (sending) "正在递信……" else "递出登岛信", enabled = !sending, onClick = ::sendLetter)
                    LetterButton("保存", enabled = !sending) {
                        text = store.save(conversationId, modelName, text)
                        status = "草稿已保存"
                        onSnackbar("登岛信草稿已保存在当前窗口与当前模型")
                    }
                    LetterButton("恢复默认", enabled = !sending) {
                        text = store.reset(conversationId, modelName)
                        status = "已恢复默认草稿"
                        reply = ""
                        replyModel = ""
                        onSnackbar("已恢复当前模型的默认登岛信")
                    }
                }
            }
            if (status.isNotBlank()) {
                item {
                    Text(
                        status,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            if (reply.isNotBlank()) {
                item {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(20.dp))
                            .padding(16.dp)
                    ) {
                        Text("另一位屋主的回信", fontWeight = FontWeight.Bold)
                        if (replyModel.isNotBlank()) {
                            Text(
                                modelDisplayName(replyModel),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                        Text(
                            reply,
                            modifier = Modifier.padding(top = 10.dp),
                            color = MaterialTheme.colorScheme.onSurface,
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LetterButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold
    )
}
