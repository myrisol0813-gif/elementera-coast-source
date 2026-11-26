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
import com.elementeracoast.app.feature.chatgpt.ChatGptConnectState
import com.elementeracoast.app.feature.serpentdesk.DevHandsRepository
import com.elementeracoast.app.feature.shell.FeaturePageTopBar
import com.elementeracoast.app.feature.shell.FeatureGuides
import com.elementeracoast.app.feature.shell.LocalOpenGuideManual
import androidx.activity.compose.BackHandler
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import kotlinx.coroutines.launch

@Composable
fun WolfScreen(
    store: WolfStore,
    shellState: CoastShellState,
    chatGpt: ChatGptConnectState,
    messages: List<ChatMessage>,
    devHands: DevHandsRepository,
    archive: GlobalArchiveRepository,
    onSelectModel: (String) -> Unit,
    onSelectImageModel: (String) -> Unit = {},
    onRefreshModels: () -> Unit,
    onChatGptConnect: () -> Unit,
    onChatGptDisconnect: () -> Unit,
    onChatGptRefresh: () -> Unit,
    onChatGptProbe: (String) -> Unit,
    onEnterLocalWorkspace: () -> Unit,
    onLogout: () -> Unit,
    onImportMessages: (List<ChatMessage>) -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit,
    onBackToChat: () -> Unit,
    openModelBoxInitially: Boolean = false,
    guideTarget: String? = null,
    onGuideConsumed: () -> Unit = {}
) {
    val state by store.state.collectAsState()
    var page by remember { mutableStateOf<WolfDestination?>(if (openModelBoxInitially) WolfDestination.ModelBox else null) }
    val current = page
    var modelPage by remember { mutableStateOf(LocalModelPage.Catalog) }
    val homeTitle = "屋主设置"
    val openManual = LocalOpenGuideManual.current
    LaunchedEffect(guideTarget) {
        if (guideTarget == null) return@LaunchedEffect
        page = when (guideTarget) {
            "profile" -> WolfDestination.Profile
            "appearance" -> WolfDestination.Appearance
            "account" -> WolfDestination.Account
            "backup" -> WolfDestination.ChatRecords
            "models", "codex", "provider" -> WolfDestination.ModelBox
            "basic" -> WolfDestination.BasicSettings
            "diagnostics" -> WolfDestination.Diagnostics
            "update" -> WolfDestination.Update
            "settings" -> null
            else -> return@LaunchedEffect
        }
        modelPage = LocalModelPage.Catalog
        onGuideConsumed()
    }
    fun back() { if (current == WolfDestination.ModelBox && modelPage != LocalModelPage.Catalog) modelPage = LocalModelPage.Catalog else if (openModelBoxInitially && current == WolfDestination.ModelBox) onBackToChat() else if (current != null) { page = null; modelPage = LocalModelPage.Catalog } else onBackToChat() }
    BackHandler(enabled = current != null) { back() }

    if (current == null) {
        Column(Modifier.fillMaxSize()) {
        FeaturePageTopBar(homeTitle, "显示资料、外观、聊天与运行设置", onBack = ::back, guide = FeatureGuides.settings)
        WolfHome(
            state = state,
            model = shellState.currentModel,
            localMode = shellState.localMode,
            onOpen = { page = it },
            onOpenManual = openManual
        )
        }
        return
    }

    Column(Modifier.fillMaxSize()) {
        val sub = if (current == WolfDestination.ModelBox && modelPage != LocalModelPage.Catalog) " — " + modelPage.title else ""
        FeaturePageTopBar("$homeTitle — ${current.title}$sub", if (shellState.localMode) "本机模式" else current.subtitle, onBack = ::back,
            guide = when (current) {
                WolfDestination.ModelBox -> FeatureGuides.models
                WolfDestination.ChatRecords -> FeatureGuides.backup
                WolfDestination.Profile -> FeatureGuides.profile
                WolfDestination.Appearance -> FeatureGuides.appearance
                WolfDestination.Account -> FeatureGuides.account
                WolfDestination.BasicSettings -> FeatureGuides.basic
                WolfDestination.Diagnostics -> FeatureGuides.diagnostics
                WolfDestination.Update -> FeatureGuides.update
            },
            actionLabel = if (current == WolfDestination.ModelBox && shellState.localMode && modelPage == LocalModelPage.Catalog) "刷新" else null,
            onAction = if (current == WolfDestination.ModelBox && shellState.localMode && modelPage == LocalModelPage.Catalog) onRefreshModels else null)
        Box(Modifier.weight(1f)) {
            when (current) {
                WolfDestination.Profile -> ProfileScreen(state, store, onAppearance = { page = WolfDestination.Appearance }, onSnackbar = onSnackbar)
                WolfDestination.Appearance -> AppearanceScreen(state, store, onSnackbar)
                WolfDestination.Account -> AccountScreen(shellState, onEnterLocalWorkspace, onLogout)
                WolfDestination.ChatRecords -> ChatRecordsScreen(
                    profile = state.profile,
                    messages = messages,
                    archive = archive,
                    localMode = shellState.localMode,
                    nativeSettings = state,
                    transferAllowed = !shellState.isStreaming && !shellState.isFinalizing && !shellState.historyLoading && !shellState.attachmentUploading,
                    onImportMessages = onImportMessages,
                    onActionLogged = onActionLogged,
                    onSnackbar = onSnackbar
                )
                WolfDestination.ModelBox -> ModelBoxScreen(
                    models = shellState.models,
                    current = shellState.currentModel,
                    onSelect = onSelectModel,
                    imageModels = shellState.imageModels,
                    currentImage = shellState.currentImageModel,
                    onSelectImage = onSelectImageModel,
                    onRefresh = onRefreshModels,
                    chatGpt = chatGpt,
                    onChatGptConnect = onChatGptConnect,
                    onChatGptDisconnect = onChatGptDisconnect,
                    onChatGptRefresh = onChatGptRefresh,
                    onChatGptProbe = onChatGptProbe,
                    localMode = shellState.localMode,
                    localPage = modelPage,
                    onLocalPage = { modelPage = it }
                )
                WolfDestination.BasicSettings -> BasicSettingsScreen(state.basic, store, onSnackbar)
                WolfDestination.Diagnostics -> DiagnosticsScreen(shellState, state)
                WolfDestination.Update -> LocalGithubUpdateScreen(onSnackbar, if (shellState.localMode) null else devHands)
            }
        }
    }
}

@Composable
private fun WolfHome(
    state: WolfState,
    model: String,
    localMode: Boolean,
    onOpen: (WolfDestination) -> Unit,
    onOpenManual: () -> Unit
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
                WolfDestination.Account -> if (localMode) "本机模式 · 无需登录" else if (state.profile.nickname.isNotBlank()) "已登录 · 前端屋主" else destination.subtitle
                WolfDestination.ModelBox -> if (localMode) "本机供应商与账户" else "当前：${model.substringAfterLast('/').take(32)}"
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
        item { WolfRow("使用手册", "按页面查看说明及操作入口", onOpenManual) }
    }
}

@Composable
private fun AccountScreen(
    shellState: CoastShellState,
    onEnterLocalWorkspace: () -> Unit,
    onLogout: () -> Unit
) {
    var confirming by remember { mutableStateOf(false) }
    val persistence = when (shellState.sessionPersistence) {
        "local" -> "本机保存，无需账号"
        "source_tour" -> "仅本次参观 · 不创建账户会话"
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
                    WolfUpdateFact("登录状态", if (shellState.localMode) "本机模式 · 无需登录" else if (shellState.sessionPersistence == "source_tour") "参观模式" else if (shellState.authenticated) "已登录" else "未登录")
                    WolfUpdateFact("账号", if (shellState.localMode) "本机独立空间" else if (shellState.sessionPersistence == "source_tour") "公开参观者" else "前端屋主")
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
        if (!shellState.localMode) item {
            Button(onClick = onEnterLocalWorkspace, modifier = Modifier.fillMaxWidth(),
                enabled = !shellState.isStreaming && !shellState.isFinalizing && !shellState.backgroundGeneration && !shellState.attachmentUploading) {
                Text("切换到本机模式")
            }
            Text("保留有效的在线登录状态；本机资料与在线资料独立保存。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            Button(onClick = { confirming = true }, modifier = Modifier.fillMaxWidth()) {
                Text(if (shellState.localMode) "返回在线模式" else if (shellState.sessionPersistence == "source_tour") "离开参观" else "退出账号")
            }
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(if (shellState.localMode) "返回在线模式？" else if (shellState.sessionPersistence == "source_tour") "离开参观模式？" else "退出当前账号？") },
            text = { Text(if (shellState.localMode) "本机资料会完整保留；有效的在线登录会话将自动恢复，失效时需重新登录。" else if (shellState.sessionPersistence == "source_tour") "返回入口；参观模式不创建云端会话。" else "只会清除当前登录态；聊天、记忆与后端数据不会被删除。") },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onLogout()
                }) { Text(if (shellState.localMode) "返回在线模式" else "退出账号") }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text("取消") }
            }
        )
    }
}

@Composable
internal fun WolfUpdateFact(label: String, value: String, mono: Boolean = false) {
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
