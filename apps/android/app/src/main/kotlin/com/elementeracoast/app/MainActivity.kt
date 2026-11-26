package com.elementeracoast.app

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import com.elementeracoast.app.core.local.NativeWorkspace
import com.elementeracoast.app.core.tour.SourceVisitGate
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.elementeracoast.app.feature.gate.GateScreen
import com.elementeracoast.app.feature.gate.MailboxNativeSurface
import com.elementeracoast.app.feature.serpentdesk.DevHandsProvider
import com.elementeracoast.app.feature.shell.CoastShellViewModel
import com.elementeracoast.app.feature.shell.MainShell
import com.elementeracoast.app.ui.theme.CoastTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeWorkspace.initialize(applicationContext)
        if (NativeWorkspace.isLocal) SourceVisitGate.leave()
        setContent {
            val vm: CoastShellViewModel = viewModel(factory = CoastShellViewModel.factory(applicationContext))
            val devHands = remember(applicationContext) { DevHandsProvider.production(applicationContext) }
            val state by vm.state.collectAsState()
            val crossWindow by vm.crossWindow.collectAsState()
            val chatGpt by vm.chatGptState.collectAsState()
            val wolf by vm.local.wolf.state.collectAsState()
            var mailboxOpen by rememberSaveable { mutableStateOf(false) }
            LaunchedEffect(wolf.appearance) { vm.syncAppearance() }

            CoastTheme(
                preset = wolf.appearance.theme,
                accentHex = wolf.appearance.accentHex,
                userBubbleHex = wolf.appearance.userBubbleHex,
                fontMode = wolf.appearance.fontMode,
                paperMode = wolf.appearance.paperMode,
                cloudOutlineEnabled = wolf.appearance.cloudOutlineEnabled,
                readingWeight = wolf.appearance.readingWeight,
                messageSurfaceAlpha = wolf.appearance.messageSurfaceAlpha,
                chatBackgroundImagePath = wolf.appearance.chatBackgroundImagePath,
                chatBackgroundDimAlpha = wolf.appearance.chatBackgroundDimAlpha,
                localFontPath = wolf.appearance.localFontPath
            ) {
                if (mailboxOpen) {
                    MailboxNativeSurface(onClose = { mailboxOpen = false })
                } else if (!state.authenticated) {
                    GateScreen(
                        password = state.password,
                        authBusy = state.authBusy,
                        authMessage = state.authMessage,
                        onPasswordChange = vm::setPassword,
                        onEnter = vm::enterCoast,
                        onOpenMailbox = { mailboxOpen = true },
                        onEnterLocal = { switchWorkspace(true) }
                    )
                } else {
                    MainShell(
                        state = state,
                        chatGpt = chatGpt,
                        services = vm.local,
                        daily = vm.daily,
                        memory = vm.memory,
                        dogtalk = vm.dogtalk,
                        devHands = devHands,
                        archive = vm.archive,
                        crossWindowRepository = vm.crossWindowRepository,
                        crossWindow = crossWindow,
                        onCrossWindowChange = vm::updateCrossWindow,
                        onOpenRoomType = vm::openRoomType,
                        onSelectConversation = vm::selectConversation,
                        onSelectSearchHit = vm::openSearchHit,
                        onNewConversation = vm::newConversation,
                        onRenameConversation = vm::renameConversation,
                        onDeleteConversation = vm::deleteConversation,
                        onSelectTheme = { preset ->
                            vm.local.wolf.setTheme(preset)
                            vm.syncAppearance()
                        },
                        onOpenFeature = vm::openFeature,
                        onBackToChat = vm::backToChat,
                        onRefresh = vm::refreshCoastState,
                        onUpdateModelPartnerAvatar = vm::updateModelPartnerAvatar,
                        onUploadAttachment = vm::uploadAttachment,
                        onRemovePendingAttachment = vm::removePendingAttachment,
                        onComposerDraftChange = vm::updateComposerDraft,
                        onSend = vm::sendMessage,
                        onSendImage = vm::sendImage,
                        onStop = vm::stopGeneration,
                        onMessageAction = vm::handleMessageAction,
                        onOpenActionLog = vm::openActionLog,
                        onSetThoughtSoilEnabled = vm::setThoughtSoilEnabled,
                        onSaveThoughtSoil = vm::saveThoughtSoilManual,
                        onResumeThoughtSoil = vm::resumeThoughtSoilAutomatic,
                        onSetContextSettings = vm::setContextSettings,
                        onImportMessages = vm::importMessages,
                        onLocalActionLogged = vm::logLocalAction,
                        onOpenModels = vm::openModelPicker,
                        onDismissModels = vm::dismissModelPicker,
                        onSelectModel = vm::selectModel,
                         onSelectImageModel = vm::selectImageModel,
                        onRefreshModels = vm::refreshModels,
                        onChatGptConnect = {
                            vm.connectChatGpt { url ->
                                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                            }
                        },
                        onChatGptDisconnect = vm::disconnectChatGpt,
                        onChatGptRefresh = vm::refreshChatGptModels,
                        onChatGptProbe = vm::probeChatGpt,
                        onEnterLocalWorkspace = {
                            if (state.isStreaming || state.isFinalizing || state.backgroundGeneration || state.attachmentUploading) vm.showPlaceholder("请等待本轮任务结束后再切换工作区。")
                            else switchWorkspace(true)
                        },
                        onLogout = {
                            if (!state.localMode) vm.logout()
                            else if (state.isStreaming || state.isFinalizing || state.backgroundGeneration || state.attachmentUploading) vm.showPlaceholder("请等待本轮任务结束后再切换工作区。")
                            else switchWorkspace(false)
                        },
                        onPlaceholder = vm::showPlaceholder,
                        onSnackbarShown = vm::clearSnackbar
                    )
                }
            }
        }
    }

    private fun switchWorkspace(local: Boolean) {
        if (!NativeWorkspace.select(applicationContext, local)) {
            android.widget.Toast.makeText(this, "无法保存模式选择，请重试", android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }
}
