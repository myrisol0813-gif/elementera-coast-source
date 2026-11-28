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
    private var dreamNotice by mutableStateOf<com.elementeracoast.app.core.local.LocalDreamNotifications.Target?>(null)
    private var chatNotice by mutableStateOf<com.elementeracoast.app.core.local.CoastMessageNotifications.Target?>(null)
    override fun onResume() {
        super.onResume()
        com.elementeracoast.app.core.local.CoastMessageNotifications.foreground=true
    }
    override fun onPause() {
        com.elementeracoast.app.core.local.CoastMessageNotifications.foreground=false
        super.onPause()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        com.elementeracoast.app.core.local.CoastMessageNotifications.target(intent)?.let{chatNotice=it;dreamNotice=null}
        com.elementeracoast.app.core.local.LocalDreamNotifications.target(intent)?.let{dreamNotice=it}
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeWorkspace.initialize(applicationContext)
        if(savedInstanceState==null) chatNotice=com.elementeracoast.app.core.local.CoastMessageNotifications.target(intent)
        if(savedInstanceState==null) dreamNotice=com.elementeracoast.app.core.local.LocalDreamNotifications.target(intent)
        com.elementeracoast.app.core.local.LocalDreamWorker.sync(applicationContext)
        com.elementeracoast.app.core.local.OnlineDreamWorker.sync(applicationContext)
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
            LaunchedEffect(chatNotice,state.authenticated,state.localMode,state.conversations,mailboxOpen){
                val target=chatNotice?:return@LaunchedEffect
                if(!state.authenticated||mailboxOpen)return@LaunchedEffect
                if(target.local!=state.localMode){
                    vm.showPlaceholder("请切换到通知所属的工作区查看消息。");chatNotice=null
                }else if(state.conversations.any{it.id==target.cid}){
                    vm.selectConversation(target.cid);chatNotice=null
                }
            }

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
                        dreamApi = vm.dreamApi,
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
                    val target=dreamNotice
                    val noticeApi=vm.dreamApi
                    if(target!=null && noticeApi!=null){
                        if(state.localMode==target.localMode && state.conversations.any{it.id==target.cid}){
                            androidx.compose.runtime.key(target){
                                com.elementeracoast.app.feature.shell.DreamTideSheet(target.cid,state.currentModel,state.localMode,noticeApi,initialTab=target.tab,onDismiss={dreamNotice=null})
                            }
                        }else if(state.localMode!=target.localMode){
                            LaunchedEffect(target){
                                vm.showPlaceholder(if(target.localMode)"这是一条本机活动通知。请切回本机模式查看。" else "这是一条在线活动通知。请切回在线模式查看。")
                                dreamNotice=null
                            }
                        }
                    }
                }
            }
        }
    }

    private fun switchWorkspace(local: Boolean) {
        if (!NativeWorkspace.select(applicationContext, local)) {
            android.widget.Toast.makeText(this, "当前本机有执行任务或模式切换未保存，请稍后重试", android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }
}
