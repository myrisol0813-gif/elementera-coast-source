package com.elementeracoast.app.feature.wolf

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import com.elementeracoast.app.BuildConfig
import com.elementeracoast.app.core.model.ChatMessage
import com.elementeracoast.app.core.model.CoastShellState
import com.elementeracoast.app.core.remote.RemoteDevUpdate
import com.elementeracoast.app.feature.serpentdesk.DevHandsRepository
import com.elementeracoast.app.feature.shell.FeatureLocalBackBar
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.launch

@Composable
fun WolfScreen(
    store: WolfStore,
    shellState: CoastShellState,
    messages: List<ChatMessage>,
    devHands: DevHandsRepository,
    archive: GlobalArchiveRepository,
    onSelectModel: (String) -> Unit,
    onRefreshModels: () -> Unit,
    onLogout: () -> Unit,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit
) {
    val state by store.state.collectAsState()
    var page by remember { mutableStateOf<WolfDestination?>(null) }
    val current = page

    if (current == null) {
        WolfHome(
            state = state,
            model = shellState.currentModel,
            onOpen = { page = it }
        )
        return
    }

    Column(Modifier.fillMaxSize()) {
        FeatureLocalBackBar("屋主设置") { page = null }
        Box(Modifier.weight(1f)) {
            when (current) {
                WolfDestination.Profile -> ProfileScreen(state, store, onAppearance = { page = WolfDestination.Appearance }, onSnackbar = onSnackbar)
                WolfDestination.Appearance -> AppearanceScreen(state, store, onSnackbar)
                WolfDestination.Account -> AccountScreen(shellState, onLogout)
                WolfDestination.ChatRecords -> ChatRecordsScreen(
                    profile = state.profile,
                    messages = messages,
                    archive = archive,
                    onImportMessages = onImportMessages,
                    onActionLogged = onActionLogged,
                    onSnackbar = onSnackbar
                )
                WolfDestination.ModelBox -> ModelBoxScreen(
                    models = shellState.models,
                    current = shellState.currentModel,
                    onSelect = onSelectModel,
                    onRefresh = onRefreshModels
                )
                WolfDestination.BasicSettings -> BasicSettingsScreen(state.basic, store, onSnackbar)
                WolfDestination.Diagnostics -> DiagnosticsScreen(shellState, state)
                WolfDestination.Update -> WolfUpdateScreen(devHands, onSnackbar)
            }
        }
    }
}

@Composable
private fun WolfHome(
    state: WolfState,
    model: String,
    onOpen: (WolfDestination) -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 26.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("人类屋主设置", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(6.dp))
        }
        items(WolfDestination.entries.filterNot { it == WolfDestination.Update }) { destination ->
            val subtitle = when (destination) {
                WolfDestination.Profile -> "${state.profile.nickname} · ${state.profile.signature}"
                WolfDestination.Appearance -> "${state.appearance.theme.label} · 用户气泡 · 重点色"
                WolfDestination.Account -> if (state.profile.nickname.isNotBlank()) "已登录 · 前端屋主" else destination.subtitle
                WolfDestination.ModelBox -> "当前：${model.substringAfterLast('/').take(32)}"
                WolfDestination.Update -> destination.subtitle
                else -> destination.subtitle
            }
            WolfRow(destination.title, subtitle) { onOpen(destination) }
        }
        item {
            WolfRow(
                title = "版本与更新",
                subtitle = "当前 Native：${BuildConfig.VERSION_NAME}"
            ) { onOpen(WolfDestination.Update) }
        }
    }
}

@Composable
private fun AccountScreen(
    shellState: CoastShellState,
    onLogout: () -> Unit
) {
    var confirming by remember { mutableStateOf(false) }
    val persistence = when (shellState.sessionPersistence) {
        "until_logout" -> "持续保持，直到主动退出"
        "legacy_expiring" -> if (shellState.sessionExpiresAtEpochSeconds > 0L) {
            "旧会话 · 会在原到期时间失效"
        } else "旧会话"
        else -> "当前会话"
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(22.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                    Text("当前账户", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(12.dp))
                    WolfUpdateFact("登录状态", if (shellState.authenticated) "已登录" else "未登录")
                    WolfUpdateFact("账号", "前端屋主")
                    WolfUpdateFact("登录保持", persistence)
                    if (shellState.sessionPersistence == "legacy_expiring") {
                        Text(
                            "旧 cookie 不会自动升级；主动退出并重新登录后会进入 until-logout 长期会话。",
                            modifier = Modifier.padding(top = 10.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
        item {
            Button(onClick = { confirming = true }, modifier = Modifier.fillMaxWidth()) {
                Text("退出账号")
            }
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("退出海岸账号？") },
            text = { Text("只会清除当前登录态；聊天、记忆与海岸数据不会被删除。") },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onLogout()
                }) { Text("退出账号") }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun WolfUpdateScreen(
    repository: DevHandsRepository,
    onSnackbar: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var update by remember { mutableStateOf<RemoteDevUpdate?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                update = repository.latestUpdate().update
            } catch (cause: Throwable) {
                error = cause.message ?: "更新信息读取失败。"
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val native = update?.native
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth(),
                role = SnowLetterSurfaceRole.StatusCard,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(22.dp)
            ) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 18.dp)) {
                    Text(native?.versionName ?: "版本与更新", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(10.dp))
                    WolfUpdateFact("PWA cache", update?.pwaCacheVersion ?: "—")
                    WolfUpdateFact("versionCode", native?.versionCode?.toString() ?: "—")
                    WolfUpdateFact("applicationId", native?.applicationId ?: "—")
                    WolfUpdateFact("稳定签名", when (native?.stableSigning) { true -> "是"; false -> "否"; null -> "—" })
                    WolfUpdateFact("可覆盖安装", when (native?.overwriteInstallable) { true -> "是"; false -> "否"; null -> "—" })
                    WolfUpdateFact("APK SHA-256", native?.apkSha256 ?: "—", mono = true)
                    WolfUpdateFact("交付来源", "Source build")
                    WolfUpdateFact("Release", "—")
                    WolfUpdateFact("APK", native?.apkFilename ?: "—")
                    native?.updateTime?.let { WolfUpdateFact("更新时间", it) }
                    native?.updateNotes?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    native?.knownRisk?.let {
                        Spacer(Modifier.height(6.dp))
                        Text("已知风险：$it", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    update?.reason?.takeIf { update?.available != true }?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    error?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = ::refresh, enabled = !busy) {
                            Text(if (busy) "处理中" else "刷新")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WolfUpdateFact(label: String, value: String, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        Text(label, modifier = Modifier.weight(.8f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        Text(value, modifier = Modifier.weight(1.5f), fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
internal fun WolfRow(title: String, subtitle: String, onClick: () -> Unit) {
    SnowLetterSurface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 19.dp, vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(3.dp))
                Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
