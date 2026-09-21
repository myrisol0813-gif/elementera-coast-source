package com.elementeracoast.app.feature.serpentdesk

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.remote.RemoteDevRun
import com.elementeracoast.app.core.remote.RemoteDevSelfCheckResponse
import com.elementeracoast.app.core.remote.RemoteDevUpdate
import com.elementeracoast.app.feature.shell.FeatureLocalBackBar
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.launch

private enum class DevHandsPage {
    Home,
    Logs,
    Update
}

@Composable
fun DevHandsScreen(
    repository: DevHandsRepository,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf(DevHandsPage.Home) }
    var selfCheck by remember { mutableStateOf<RemoteDevSelfCheckResponse?>(null) }
    var update by remember { mutableStateOf<RemoteDevUpdate?>(null) }
    var logs by remember { mutableStateOf<List<RemoteDevRun>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    suspend fun refreshOverview() {
        busy = true
        message = null
        try {
            selfCheck = repository.selfCheck()
        } catch (error: Throwable) {
            message = error.message ?: "开发手自检失败。"
        } finally {
            busy = false
        }
    }

    suspend fun refreshLogs() {
        busy = true
        message = null
        try {
            logs = repository.logs(120).runs
        } catch (error: Throwable) {
            message = error.message ?: "开发手脚印读取失败。"
        } finally {
            busy = false
        }
    }

    suspend fun refreshUpdate() {
        busy = true
        message = null
        try {
            update = repository.latestUpdate().update
        } catch (error: Throwable) {
            message = error.message ?: "更新信息读取失败。"
        } finally {
            busy = false
        }
    }

    LaunchedEffect(Unit) { refreshOverview() }

    Column(Modifier.fillMaxSize()) {
        FeatureLocalBackBar(
            when (page) {
                DevHandsPage.Home -> "前端开发手"
                DevHandsPage.Logs -> "开发手脚印"
                DevHandsPage.Update -> "版本与更新"
            }
        ) {
            if (page == DevHandsPage.Home) onBack()
            else {
                page = DevHandsPage.Home
                message = null
            }
        }

        when (page) {
            DevHandsPage.Home -> DevHandsHome(
                selfCheck = selfCheck,
                busy = busy,
                message = message,
                onRefresh = { scope.launch { refreshOverview() } },
                onOpenLogs = {
                    page = DevHandsPage.Logs
                    scope.launch { refreshLogs() }
                },
                onOpenUpdate = {
                    page = DevHandsPage.Update
                    scope.launch { refreshUpdate() }
                }
            )

            DevHandsPage.Logs -> DevHandsLogs(
                logs = logs,
                busy = busy,
                message = message,
                onRefresh = { scope.launch { refreshLogs() } }
            )

            DevHandsPage.Update -> DevHandsUpdate(
                update = update,
                busy = busy,
                message = message,
                onRefresh = { scope.launch { refreshUpdate() } },
            )
        }
    }
}

@Composable
private fun DevHandsHome(
    selfCheck: RemoteDevSelfCheckResponse?,
    busy: Boolean,
    message: String?,
    onRefresh: () -> Unit,
    onOpenLogs: () -> Unit,
    onOpenUpdate: () -> Unit
) {
    val github = selfCheck?.github
    val notion = selfCheck?.notion
    val toolGroups = selfCheck?.developerTools.orEmpty().groupBy { it.pack ?: "开发手" }.toList()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SoftPanel {
                Text("开发手默认随身", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(7.dp))
                Text(
                    "普通 owner 聊天直接拥有 GitHub、Notion、CI、APK 与屋主设置开发手。没有施工模式、工具开关、pending、确认卡或危险锁柜。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(Modifier.height(12.dp))
                StatusLine("模型工具默认随身", selfCheck?.modelToolsDefault)
                StatusLine("GitHub token", github?.githubTokenPresent)
                StatusLine("allowlist 仓库", github?.repoMetadataReadable)
                StatusLine("Actions", github?.canReadActions)
                StatusLine("Notion token", notion?.notionTokenPresent)
                StatusLine("工作日志 root", notion?.rootPageReadable)
                notion?.rootPageTitle?.let {
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                }
                selfCheck?.release?.let {
                    Spacer(Modifier.height(8.dp))
                    Text("release · $it", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                }
                Spacer(Modifier.height(10.dp))
                Button(onClick = onRefresh, enabled = !busy) {
                    Text(if (busy) "正在自检" else "重新自检")
                }
            }
        }

        item {
            SoftPanel {
                Text("模型当前可见", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(5.dp))
                Text(
                    "${selfCheck?.developerTools?.size ?: 0} 个开发手 schema，直接随 owner 聊天递给模型。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }

        items(toolGroups, key = { it.first }) { group ->
            val pack = group.first
            val tools = group.second
            SoftPanel {
                Text("$pack · ${tools.size}", fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(7.dp))
                tools.forEach { tool ->
                    val meta = listOfNotNull(tool.targetSystem, tool.risk).filter { it.isNotBlank() }.joinToString(" · ")
                    Text(
                        if (meta.isBlank()) tool.name else "${tool.name} · $meta",
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }
        }

        item { DeskEntry("开发手脚印", "模型真实调用 · 成功 / 失败 · 脱敏摘要", onOpenLogs) }
        item { DeskEntry("版本与更新", "PWA · Native · APK · SHA-256", onOpenUpdate) }
        message?.let { item { StatusMessage(it) } }
    }
}

@Composable
private fun DevHandsLogs(
    logs: List<RemoteDevRun>,
    busy: Boolean,
    message: String?,
    onRefresh: () -> Unit
) {
    val success = logs.count { it.status == "success" }
    val failure = logs.count { it.status == "error" }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        item {
            SoftPanel {
                Text("小蛇最近摆弄了 ${logs.size} 件工具", fontWeight = FontWeight.SemiBold)
                Text(
                    "成功 $success · 失败 $failure",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(Modifier.height(9.dp))
                Button(onClick = onRefresh, enabled = !busy) { Text(if (busy) "刷新中" else "刷新脚印") }
            }
        }

        if (logs.isEmpty()) item { StatusMessage(message ?: "还没有开发手调用记录。") }

        items(logs, key = { it.id }) { run ->
            SoftPanel {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(run.actionName.ifBlank { "开发手" }, fontWeight = FontWeight.SemiBold)
                        Text(
                            "${run.targetSystem.ifBlank { "开发手" }} · ${run.targetRef ?: "—"}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Text(run.status.ifBlank { "unknown" }, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.height(6.dp))
                Text(run.operationType, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                run.outputSummary?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it.toString(), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                run.errorSummary?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        if (logs.isNotEmpty()) message?.let { item { StatusMessage(it) } }
    }
}

@Composable
private fun DevHandsUpdate(
    update: RemoteDevUpdate?,
    busy: Boolean,
    message: String?,
    onRefresh: () -> Unit
) {
    val native = update?.native
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SoftPanel {
                Text(native?.versionName ?: "版本与更新", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(12.dp))
                Fact("Release", update?.release ?: "—")
                Fact("PWA cache", update?.pwaCacheVersion ?: "—")
                Fact("versionCode", native?.versionCode?.toString() ?: "—")
                Fact("applicationId", native?.applicationId ?: "—")
                Fact("稳定签名", when (native?.stableSigning) { true -> "是"; false -> "否"; null -> "—" })
                Fact("可覆盖安装", when (native?.overwriteInstallable) { true -> "是"; false -> "否"; null -> "—" })
                Fact("APK SHA-256", native?.apkSha256 ?: "—", mono = true)
                Fact("交付来源", "Source build")
                Fact("Release tag", "—")
                Fact("APK", native?.apkFilename ?: "—")
                native?.updateNotes?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                native?.knownRisk?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = onRefresh, enabled = !busy) { Text("刷新") }
                }
            }
        }
        if (update?.available != true) item { StatusMessage(update?.reason ?: message ?: "暂无可用 Release。") }
        else message?.let { item { StatusMessage(it) } }
    }
}

@Composable
private fun SoftPanel(content: @Composable ColumnScope.() -> Unit) {
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth(),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 17.dp), content = content)
    }
}

@Composable
private fun DeskEntry(title: String, subtitle: String, onClick: () -> Unit) {
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun StatusLine(label: String, value: Boolean?) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        Text(when (value) { true -> "可用"; false -> "不可用"; null -> "未检查" }, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun Fact(label: String, value: String, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.Top) {
        Text(label, modifier = Modifier.weight(.8f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        Text(value, modifier = Modifier.weight(1.5f), fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StatusMessage(value: String) {
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth(),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(18.dp)
    ) {
        Text(
            value,
            Modifier.padding(horizontal = 16.dp, vertical = 13.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
        )
    }
}
