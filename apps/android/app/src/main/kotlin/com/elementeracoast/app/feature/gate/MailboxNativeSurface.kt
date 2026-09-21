package com.elementeracoast.app.feature.gate

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.network.CoastApiErrorKind
import com.elementeracoast.app.core.network.CoastApiException
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch

private enum class MailboxPane {
    Boot,
    Choices,
    Login,
    Register,
    Room
}

private enum class MailboxSheet {
    Soil,
    Notebook
}

@Composable
fun MailboxNativeSurface(onClose: () -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { MailboxRepository.production(context.applicationContext) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val listState = rememberLazyListState()

    var pane by remember { mutableStateOf(MailboxPane.Boot) }
    var visitor by remember { mutableStateOf<MailboxVisitor?>(null) }
    var messages by remember { mutableStateOf<List<MailboxMessage>>(emptyList()) }
    var status by remember { mutableStateOf(MailboxStatus()) }
    var memory by remember { mutableStateOf(MailboxMemory()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var composer by remember { mutableStateOf("") }
    var activeSheet by remember { mutableStateOf<MailboxSheet?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<MailboxMessage?>(null) }
    var deleting by remember { mutableStateOf<MailboxMessage?>(null) }
    var confirmDeleteAccount by remember { mutableStateOf(false) }

    fun resetToEntry(message: String? = null) {
        visitor = null
        messages = emptyList()
        status = MailboxStatus()
        memory = MailboxMemory()
        composer = ""
        activeSheet = null
        error = message
        pane = MailboxPane.Choices
    }

    fun handleFailure(cause: Throwable, fallback: String) {
        val api = cause as? CoastApiException
        if (api?.kind == CoastApiErrorKind.Unauthorized || api?.status == 401) {
            resetToEntry(api.message)
        } else {
            error = cause.message ?: fallback
        }
    }

    fun refreshRoom(announce: Boolean = false) {
        if (busy || pane != MailboxPane.Room) return
        busy = true
        error = null
        scope.launch {
            try {
                val snapshot = repository.roomSnapshot()
                messages = snapshot.messages
                status = snapshot.status
                memory = snapshot.memory
                if (announce) notice = "信箱已经刷新。"
            } catch (cause: Throwable) {
                handleFailure(cause, "信箱暂时没有同步。")
            } finally {
                busy = false
            }
        }
    }

    fun enterRoom(resolvedVisitor: MailboxVisitor) {
        visitor = resolvedVisitor
        pane = MailboxPane.Room
        busy = true
        error = null
        scope.launch {
            try {
                val snapshot = repository.roomSnapshot()
                messages = snapshot.messages
                status = snapshot.status
                memory = snapshot.memory
            } catch (cause: Throwable) {
                handleFailure(cause, "访客信箱没有打开。")
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) {
        if (!repository.hasSession()) {
            pane = MailboxPane.Choices
            return@LaunchedEffect
        }
        busy = true
        try {
            val current = repository.me()
            visitor = current
            pane = MailboxPane.Room
            val snapshot = repository.roomSnapshot()
            messages = snapshot.messages
            status = snapshot.status
            memory = snapshot.memory
        } catch (cause: Throwable) {
            handleFailure(cause, "访客登录态暂时无法确认。")
        } finally {
            busy = false
        }
    }

    LaunchedEffect(messages.size, pane) {
        if (pane == MailboxPane.Room && messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex + 2)
        }
    }

    BackHandler {
        when (pane) {
            MailboxPane.Login, MailboxPane.Register -> {
                error = null
                pane = MailboxPane.Choices
            }
            else -> onClose()
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            MailboxTopBar(
                pane = pane,
                visitor = visitor,
                busy = busy,
                menuOpen = menuOpen,
                onMenuChange = { menuOpen = it },
                onBack = {
                    error = null
                    pane = MailboxPane.Choices
                },
                onRefresh = { refreshRoom(true) },
                onLogout = {
                    menuOpen = false
                    busy = true
                    scope.launch {
                        repository.logout()
                        busy = false
                        resetToEntry("已经退出这间访客信箱。")
                    }
                },
                onDeleteAccount = {
                    menuOpen = false
                    confirmDeleteAccount = true
                },
                onClose = onClose
            )
        },
        bottomBar = {
            if (pane == MailboxPane.Room) {
                MailboxComposer(
                    value = composer,
                    busy = busy,
                    onValueChange = { composer = it },
                    onSend = {
                        val text = composer.trim()
                        if (text.isBlank() || busy) return@MailboxComposer
                        busy = true
                        error = null
                        scope.launch {
                            try {
                                val sent = repository.send(text)
                                composer = ""
                                messages = messages + sent
                                status = status.copy(
                                    pending_count = status.pending_count + 1,
                                    last_visitor_message_at = sent.created_at,
                                    queue_status = "pending"
                                )
                                notice = "信已经投入访客信箱。等待另一位屋主下一次查看。"
                            } catch (cause: Throwable) {
                                handleFailure(cause, "这封信暂时没有送达。")
                            } finally {
                                busy = false
                            }
                        }
                    }
                )
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (pane) {
                MailboxPane.Boot -> MailboxLoading("正在确认访客信箱…")
                MailboxPane.Choices -> MailboxEntryChoices(
                    error = error,
                    onLogin = {
                        error = null
                        pane = MailboxPane.Login
                    },
                    onRegister = {
                        error = null
                        pane = MailboxPane.Register
                    }
                )
                MailboxPane.Login -> MailboxLogin(
                    busy = busy,
                    error = error,
                    onSubmit = { passphrase ->
                        if (busy) return@MailboxLogin
                        busy = true
                        error = null
                        scope.launch {
                            try {
                                enterRoom(repository.login(passphrase))
                            } catch (cause: Throwable) {
                                handleFailure(cause, "没有进入信箱，请稍后再试。")
                                if (pane == MailboxPane.Choices) pane = MailboxPane.Login
                            } finally {
                                busy = false
                            }
                        }
                    }
                )
                MailboxPane.Register -> MailboxRegister(
                    busy = busy,
                    error = error,
                    onSubmit = { displayName, passphrase, preferredName, allowMemory ->
                        if (busy) return@MailboxRegister
                        busy = true
                        error = null
                        scope.launch {
                            try {
                                enterRoom(
                                    repository.register(
                                        displayName = displayName,
                                        passphrase = passphrase,
                                        preferredName = preferredName,
                                        allowMemory = allowMemory
                                    )
                                )
                            } catch (cause: Throwable) {
                                handleFailure(cause, "没有登记成功，请稍后再试。")
                                if (pane == MailboxPane.Choices) pane = MailboxPane.Register
                            } finally {
                                busy = false
                            }
                        }
                    }
                )
                MailboxPane.Room -> MailboxRoom(
                    listState = listState,
                    visitor = visitor,
                    messages = messages,
                    status = status,
                    memory = memory,
                    busy = busy,
                    error = error,
                    notice = notice,
                    onClearNotice = { notice = null },
                    onOpenSoil = { activeSheet = MailboxSheet.Soil },
                    onOpenNotebook = { activeSheet = MailboxSheet.Notebook },
                    onCopy = { message ->
                        clipboard.setText(AnnotatedString(message.content))
                        notice = "已复制"
                    },
                    onEdit = { editing = it },
                    onDelete = { deleting = it }
                )
            }
        }
    }

    activeSheet?.let { sheet ->
        MailboxMemorySheet(
            sheet = sheet,
            visitor = visitor,
            memory = memory,
            busy = busy,
            onDismiss = { activeSheet = null },
            onResolvePocket = { pocketId, action ->
                if (busy) return@MailboxMemorySheet
                busy = true
                scope.launch {
                    try {
                        repository.resolvePocket(pocketId, action)
                        memory = repository.roomSnapshot().memory
                        notice = if (action == "remember") "已经收进访客记事本。" else "这枚候选已经放回潮水里。"
                    } catch (cause: Throwable) {
                        handleFailure(cause, "这枚候选暂时没有处理。")
                    } finally {
                        busy = false
                    }
                }
            },
            onDeleteEntry = { entryId ->
                if (busy) return@MailboxMemorySheet
                busy = true
                scope.launch {
                    try {
                        repository.deleteMemoryEntry(entryId)
                        memory = repository.roomSnapshot().memory
                        notice = "这条访客记事已经删除。"
                    } catch (cause: Throwable) {
                        handleFailure(cause, "这条访客记事暂时没有删除。")
                    } finally {
                        busy = false
                    }
                }
            }
        )
    }

    editing?.let { message ->
        var value by remember(message.id) { mutableStateOf(message.content) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("编辑来信") },
            text = {
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 4,
                    maxLines = 10
                )
            },
            confirmButton = {
                TextButton(
                    enabled = value.trim().isNotEmpty() && !busy,
                    onClick = {
                        val updated = value.trim()
                        busy = true
                        scope.launch {
                            try {
                                repository.editMessage(message.id, updated)
                                editing = null
                                val snapshot = repository.roomSnapshot()
                                messages = snapshot.messages
                                status = snapshot.status
                                memory = snapshot.memory
                                notice = "这封来信已经更新，并重新等待巡灯。"
                            } catch (cause: Throwable) {
                                handleFailure(cause, "这封来信暂时没有更新。")
                            } finally {
                                busy = false
                            }
                        }
                    }
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消") } }
        )
    }

    deleting?.let { message ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(if (message.role == "visitor") "删除这条来信？" else "删除这条另一位屋主回信？") },
            text = {
                Text(
                    if (message.role == "visitor") {
                        "如果这是这一轮唯一的访客消息，关联的另一位屋主回信也可能一起移除。"
                    } else {
                        "只删除当前选中的另一位屋主回信；其他访客房间不会受到影响。"
                    }
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                repository.deleteMessage(message.id)
                                deleting = null
                                val snapshot = repository.roomSnapshot()
                                messages = snapshot.messages
                                status = snapshot.status
                                memory = snapshot.memory
                                notice = "这条消息已经删除。"
                            } catch (cause: Throwable) {
                                handleFailure(cause, "这条消息暂时没有删除。")
                            } finally {
                                busy = false
                            }
                        }
                    }
                ) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }
        )
    }

    if (confirmDeleteAccount) {
        AlertDialog(
            onDismissRequest = { confirmDeleteAccount = false },
            title = { Text("删除整个访客信箱对话？") },
            text = { Text("暗号、全部来信与回信、整理当前对话的纸条、待确认区和访客记事本都会永久删除。") },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                repository.deleteAccount()
                                confirmDeleteAccount = false
                                busy = false
                                resetToEntry("这间访客信箱已经删除。")
                            } catch (cause: Throwable) {
                                handleFailure(cause, "整个访客房间暂时没有删除。")
                                busy = false
                            }
                        }
                    }
                ) { Text("删除全部数据") }
            },
            dismissButton = { TextButton(onClick = { confirmDeleteAccount = false }) { Text("取消") } }
        )
    }
}

@Composable
private fun MailboxTopBar(
    pane: MailboxPane,
    visitor: MailboxVisitor?,
    busy: Boolean,
    menuOpen: Boolean,
    onMenuChange: (Boolean) -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
    onClose: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text("访客信箱", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                when (pane) {
                    MailboxPane.Room -> "${visitor?.preferred_name ?: visitor?.display_name ?: "访客"} · 慢速回信房间"
                    MailboxPane.Login -> "输入暗号"
                    MailboxPane.Register -> "填记名册"
                    else -> "访客隔离场域 · Native"
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
        when (pane) {
            MailboxPane.Login, MailboxPane.Register -> TextButton(onClick = onBack) { Text("返回") }
            MailboxPane.Room -> {
                IconButton(enabled = !busy, onClick = onRefresh) {
                    Icon(Icons.Default.Refresh, contentDescription = "刷新信箱")
                }
                Box {
                    IconButton(onClick = { onMenuChange(true) }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "信箱菜单")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { onMenuChange(false) }) {
                        DropdownMenuItem(text = { Text("退出访客身份") }, onClick = onLogout)
                        DropdownMenuItem(text = { Text("删除整个信箱") }, onClick = onDeleteAccount)
                    }
                }
            }
            else -> Unit
        }
        IconButton(onClick = onClose) {
            Icon(Icons.Default.Close, contentDescription = "关闭")
        }
    }
}

@Composable
private fun MailboxLoading(text: String) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(12.dp))
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MailboxEntryChoices(
    error: String?,
    onLogin: () -> Unit,
    onRegister: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("给来访海岸的人留一间慢一点的房间。", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "这里使用独立访客身份，不读取屋主主聊天、全局摘录、自定义指令或其他私人海岸资料。",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
        error?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(24.dp))
        Button(onClick = onLogin, modifier = Modifier.fillMaxWidth()) { Text("我来过 · 输入暗号") }
        Spacer(Modifier.height(10.dp))
        TextButton(onClick = onRegister, modifier = Modifier.fillMaxWidth()) { Text("第一次来 · 填记名册") }
    }
}

@Composable
private fun MailboxLogin(
    busy: Boolean,
    error: String?,
    onSubmit: (String) -> Unit
) {
    var passphrase by remember { mutableStateOf("") }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("回到只属于你的信箱房间。", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(18.dp))
        OutlinedTextField(
            value = passphrase,
            onValueChange = { passphrase = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("暗号") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true
        )
        error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(16.dp))
        Button(
            modifier = Modifier.fillMaxWidth(),
            enabled = passphrase.isNotBlank() && !busy,
            onClick = { onSubmit(passphrase) }
        ) {
            Text(if (busy) "正在进入…" else "进入聊天室")
        }
    }
}

@Composable
private fun MailboxRegister(
    busy: Boolean,
    error: String?,
    onSubmit: (String, String, String, Boolean) -> Unit
) {
    var displayName by remember { mutableStateOf("") }
    var passphrase by remember { mutableStateOf("") }
    var preferredName by remember { mutableStateOf("") }
    var allowMemory by remember { mutableStateOf(true) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text("登记一间新的访客房间。", style = MaterialTheme.typography.titleMedium)
            Text(
                "暗号只用于这间信箱；Native 保存的是独立加密访客会话，不与屋主登录态混用。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
        item {
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("称呼") },
                singleLine = true
            )
        }
        item {
            OutlinedTextField(
                value = passphrase,
                onValueChange = { passphrase = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("暗号") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true
            )
        }
        item {
            OutlinedTextField(
                value = preferredName,
                onValueChange = { preferredName = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("希望另一位屋主怎么称呼我（可选）") },
                singleLine = true
            )
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = allowMemory, onCheckedChange = { allowMemory = it })
                Text(
                    "允许另一位屋主在这位访客自己的记事本里保存少量偏好",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        error?.let { message ->
            item { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
        item {
            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = displayName.isNotBlank() && passphrase.isNotBlank() && !busy,
                onClick = { onSubmit(displayName.trim(), passphrase, preferredName.trim(), allowMemory) }
            ) {
                Text(if (busy) "正在登记…" else "登记并进入")
            }
        }
    }
}

@Composable
private fun MailboxRoom(
    listState: androidx.compose.foundation.lazy.LazyListState,
    visitor: MailboxVisitor?,
    messages: List<MailboxMessage>,
    status: MailboxStatus,
    memory: MailboxMemory,
    busy: Boolean,
    error: String?,
    notice: String?,
    onClearNotice: () -> Unit,
    onOpenSoil: () -> Unit,
    onOpenNotebook: () -> Unit,
    onCopy: (MailboxMessage) -> Unit,
    onEdit: (MailboxMessage) -> Unit,
    onDelete: (MailboxMessage) -> Unit
) {
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            MailboxStatusCard(status)
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onOpenSoil) {
                    Text("整理当前对话的纸条 · ${memory.thought_soil.hand_seeds.size.coerceAtMost(7)} 粒当前活跃线索")
                }
                if (visitor?.allow_memory == true) {
                    TextButton(onClick = onOpenNotebook) {
                        Text("访客记事 · ${memory.entries.size} · 待确认 ${memory.pending_pockets.size}")
                    }
                }
            }
        }
        error?.let { message ->
            item { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
        notice?.let { message ->
            item {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onClearNotice),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Text(message, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (messages.isEmpty() && !busy) {
            item {
                Text(
                    "这里还没有来信。你可以把第一封信投进海岸。",
                    modifier = Modifier.fillMaxWidth().padding(vertical = 52.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
        items(messages, key = { it.id }) { message ->
            MailboxMessageCard(
                message = message,
                onCopy = { onCopy(message) },
                onEdit = { onEdit(message) },
                onDelete = { onDelete(message) }
            )
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun MailboxStatusCard(status: MailboxStatus) {
    val title: String
    val detail: String
    when {
        status.pending_count > 0 -> {
            title = "已送达灯塔，等待另一位屋主查看。"
            detail = "${status.pending_count} 封来信正在等待 · 这里是慢速回信模式。"
        }
        status.last_myri_reply_at != null -> {
            title = "回信已经抵达。"
            detail = "最近回信：${mailboxTime(status.last_myri_reply_at)} · 你可以继续写下一封。"
        }
        else -> {
            title = "现在是慢速回信模式，不是实时聊天。"
            detail = "屋主知道有人来过，但默认不会读取访客具体写了什么。"
        }
    }
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth(),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(20.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun MailboxMessageCard(
    message: MailboxMessage,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val visitorMessage = message.role == "visitor"
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (visitorMessage) Alignment.End else Alignment.Start
    ) {
        if (visitorMessage) {
            Surface(
                modifier = Modifier.widthIn(max = 330.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(18.dp)
            ) {
                Text(message.content, modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp))
            }
        } else {
            SnowLetterSurface(
                modifier = Modifier.fillMaxWidth().padding(end = 22.dp),
                role = SnowLetterSurfaceRole.AssistantBubble,
                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                fallbackShape = RoundedCornerShape(18.dp)
            ) {
                Text(
                    message.content,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
        Spacer(Modifier.height(3.dp))
        Text(
            if (visitorMessage) {
                "${mailboxTime(message.created_at)} · ${visitorStatusLabel(message.status)}"
            } else {
                "Model Partner · ${mailboxTime(message.created_at)}"
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall
        )
        Row {
            if (!visitorMessage) {
                IconButton(onClick = onCopy) { Icon(Icons.Default.ContentCopy, contentDescription = "复制") }
            } else {
                IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, contentDescription = "编辑") }
            }
            IconButton(onClick = onDelete) { Icon(Icons.Default.DeleteOutline, contentDescription = "删除") }
        }
    }
}

@Composable
private fun MailboxComposer(
    value: String,
    busy: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding()
            .imePadding()
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .55f))
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            Surface(
                modifier = Modifier.weight(1f).heightIn(min = 48.dp, max = 120.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(22.dp)
            ) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp)) {
                    if (value.isBlank()) {
                        Text(
                            "写一封慢一点的信…",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    BasicTextField(
                        value = value,
                        onValueChange = onValueChange,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                        textStyle = MaterialTheme.typography.bodyMedium.copy(
                            color = MaterialTheme.colorScheme.onSurface
                        ),
                        maxLines = 6
                    )
                }
            }
            Spacer(Modifier.padding(horizontal = 3.dp))
            IconButton(enabled = value.trim().isNotEmpty() && !busy, onClick = onSend) {
                Icon(Icons.Default.Send, contentDescription = "投递来信")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MailboxMemorySheet(
    sheet: MailboxSheet,
    visitor: MailboxVisitor?,
    memory: MailboxMemory,
    busy: Boolean,
    onDismiss: () -> Unit,
    onResolvePocket: (String, String) -> Unit,
    onDeleteEntry: (String) -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 22.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Text(
                    if (sheet == MailboxSheet.Soil) "整理当前对话的纸条" else "访客记事本",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    if (sheet == MailboxSheet.Soil) "当前访客房间自己的滚动工作上下文" else "只属于这位访客的待确认区与轻量记忆",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            if (sheet == MailboxSheet.Soil) {
                item { MailboxMemoryBlock("当前", memory.thought_soil.current_text.ifBlank { "还没有整理当前方向。" }) }
                item {
                    MailboxMemoryBlock(
                        "当前活跃线索 · ${memory.thought_soil.hand_seeds.size.coerceAtMost(7)}/7",
                        memory.thought_soil.hand_seeds.take(7).joinToString("\n\n") {
                            buildString {
                                append(it.name.ifBlank { it.life_core })
                                if (it.life_core.isNotBlank() && it.life_core != it.name) append("\n").append(it.life_core)
                                if (it.usage_hint.isNotBlank()) append("\n使用：").append(it.usage_hint)
                                if (it.avoid_hint.isNotBlank()) append("\n避免：").append(it.avoid_hint)
                            }
                        }.ifBlank { "还没有当前活跃线索。" }
                    )
                }
                item { MailboxMemoryBlock("勿复读", memory.thought_soil.do_not_repeat.ifBlank { "还没有内容。" }) }
                item {
                    Text(
                        "revision ${memory.thought_soil.revision} · 整理来源 · " +
                            listOfNotNull(memory.thought_soil.model_label, memory.thought_soil.model_nickname)
                                .joinToString(" · ").ifBlank { "尚未整理" },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            } else if (visitor?.allow_memory != true) {
                item {
                    MailboxMemoryBlock(
                        "访客记事未开启",
                        "登记时没有开启访客记事本；整理当前对话的纸条仍只作为当前房间的滚动工作上下文。"
                    )
                }
            } else {
                item {
                    Text("待确认区 · ${memory.pending_pockets.size}", fontWeight = FontWeight.SemiBold)
                }
                if (memory.pending_pockets.isEmpty()) {
                    item { Text("待确认区是空的。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                items(memory.pending_pockets, key = { "pocket-${it.id}" }) { pocket ->
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(18.dp)
                    ) {
                        Column(Modifier.fillMaxWidth().padding(15.dp)) {
                            Text(pocket.title.ifBlank { "待确认内容" }, fontWeight = FontWeight.SemiBold)
                            Text(pocket.life_core, style = MaterialTheme.typography.bodySmall)
                            if (pocket.content.isNotBlank() && pocket.content != pocket.life_core) {
                                Spacer(Modifier.height(5.dp))
                                Text(pocket.content, style = MaterialTheme.typography.bodySmall)
                            }
                            Row {
                                TextButton(enabled = !busy, onClick = { onResolvePocket(pocket.id, "remember") }) { Text("确认落袋") }
                                TextButton(enabled = !busy, onClick = { onResolvePocket(pocket.id, "discard") }) { Text("丢弃") }
                            }
                        }
                    }
                }
                item { Text("访客记事", fontWeight = FontWeight.SemiBold) }
                if (memory.entries.isEmpty()) {
                    item { Text("这里还没有记事。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                items(memory.entries, key = { "entry-${it.id}" }) { entry ->
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(18.dp)
                    ) {
                        Column(Modifier.fillMaxWidth().padding(15.dp)) {
                            Text(entry.title.ifBlank { entry.life_core }, fontWeight = FontWeight.SemiBold)
                            Text(entry.life_core, style = MaterialTheme.typography.bodySmall)
                            if (entry.content.isNotBlank() && entry.content != entry.life_core) {
                                Spacer(Modifier.height(5.dp))
                                Text(entry.content, style = MaterialTheme.typography.bodySmall)
                            }
                            TextButton(enabled = !busy, onClick = { onDeleteEntry(entry.id) }) { Text("删除") }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun MailboxMemoryBlock(title: String, text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.padding(15.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(5.dp))
            Text(text, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun visitorStatusLabel(status: String): String = when (status) {
    "waiting_for_myri" -> "已送达 · 等待巡灯"
    "replied" -> "已回信"
    else -> "已送达"
}

private fun mailboxTime(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    return runCatching {
        MAILBOX_TIME_FORMATTER.format(Instant.parse(value))
    }.getOrElse { value }
}

private val MAILBOX_TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofPattern("MM-dd HH:mm", Locale.CHINA)
        .withZone(ZoneId.systemDefault())
