package com.elementeracoast.app.feature.daily

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.elementeracoast.app.core.model.modelDisplayName
import com.elementeracoast.app.core.network.CoastApiException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

@Composable
internal fun MomentScreen(
    repository: DailyRepository,
    myriAvatarDataUrl: String,
    onUpdateModelPartnerAvatar: (String) -> Unit,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit,
    onCompose: () -> Unit
) {
    val snapshot by repository.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var commenting by remember { mutableStateOf<DailyMoment?>(null) }
    var editing by remember { mutableStateOf<DailyMoment?>(null) }
    var deleting by remember { mutableStateOf<DailyMoment?>(null) }
    var editingModelPartnerName by remember { mutableStateOf(false) }
    var myriBusyId by remember { mutableStateOf<String?>(null) }

    fun reportFailure(label: String, error: Throwable) {
        val detail = if (error is CoastApiException) error.message else error.message ?: "未知错误"
        onSnackbar("$label：$detail")
    }

    fun uploadDailyImage(uri: Uri?, field: DailyProfileImageField, label: String) {
        if (uri == null) return
        scope.launch {
            try {
                val dataUrl = DailyImageCodec.encodeForProfile(context, uri, field)
                repository.updateProfile(field, dataUrl)
                onSnackbar("$label 已写回海岸")
            } catch (error: Throwable) {
                reportFailure("$label 更新失败", error)
            }
        }
    }

    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uploadDailyImage(uri, DailyProfileImageField.HumanOwnerAvatar, "屋主头像")
    }
    val myriPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    val dataUrl = DailyImageCodec.encodeForProfile(context, uri, DailyProfileImageField.ModelPartnerAvatar)
                    onUpdateModelPartnerAvatar(dataUrl)
                } catch (error: Throwable) {
                    reportFailure("另一位屋主头像更新失败", error)
                }
            }
        }
    }
    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uploadDailyImage(uri, DailyProfileImageField.MomentCover, "碳硅圈封面")
    }

    LazyColumn(
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 0.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            DailyCover(snapshot.profile.momentCoverDataUrl) { coverPicker.launch(arrayOf("image/*")) }
            Spacer(Modifier.height(12.dp))
        }
        item {
            DailyIdentityBar(
                profileUri = snapshot.profile.xiaohanAvatarDataUrl,
                myriUri = myriAvatarDataUrl,
                myriLabel = snapshot.profile.myriDisplayName,
                onProfileClick = { avatarPicker.launch(arrayOf("image/*")) },
                onModelPartnerAvatarClick = { myriPicker.launch(arrayOf("image/*")) },
                onModelPartnerNameClick = { editingModelPartnerName = true }
            )
        }
        if (snapshot.moments.isEmpty()) {
            item {
                Spacer(Modifier.height(18.dp))
                DailySurfaceCard {
                    Text("还没有动态。", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("想写的时候留一点潮声。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(10.dp))
                    Text("＋ 写一条", modifier = Modifier.clickable(onClick = onCompose), color = MaterialTheme.colorScheme.primary)
                }
            }
        } else {
            items(snapshot.moments, key = { it.id }) { moment ->
                val xiaohan = moment.isHumanOwner
                val editableModelPartnerAuthor = moment.author == "api" || moment.author == "myri"
                MomentCard(
                    moment = moment,
                    avatarUri = if (xiaohan) snapshot.profile.xiaohanAvatarDataUrl else myriAvatarDataUrl,
                    avatarFallback = if (xiaohan) "H" else "M",
                    authorLabel = momentAuthorLabel(moment, snapshot.profile.myriDisplayName),
                    myriDisplayName = snapshot.profile.myriDisplayName,
                    authorEditable = editableModelPartnerAuthor,
                    myriCommentBusy = myriBusyId == moment.id,
                    onEditModelPartnerName = { editingModelPartnerName = true },
                    onLike = {
                        scope.launch {
                            try { repository.setMomentLike(moment.id, !moment.liked) }
                            catch (error: Throwable) { reportFailure("点赞写回失败", error) }
                        }
                    },
                    onComment = { commenting = moment },
                    onModelPartnerComment = {
                        if (myriBusyId == null) {
                            myriBusyId = moment.id
                            scope.launch {
                                try {
                                    repository.requestModelPartnerComment(moment.id)
                                    onActionLogged("daily.moment.myri-comment", "另一位屋主留言", "海岸已生成并保存 1 条真实留言")
                                    onSnackbar("另一位屋主已在海岸留下回复")
                                } catch (error: Throwable) {
                                    reportFailure("另一位屋主留言失败", error)
                                } finally {
                                    myriBusyId = null
                                }
                            }
                        }
                    },
                    onEdit = { editing = moment },
                    onDelete = { deleting = moment }
                )
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    if (editingModelPartnerName) {
        ModelPartnerNameDialog(
            initial = snapshot.profile.myriDisplayName,
            onDismiss = { editingModelPartnerName = false },
            onSave = { raw ->
                scope.launch {
                    try {
                        repository.updateModelPartnerDisplayName(raw)
                        editingModelPartnerName = false
                        onSnackbar("另一位屋主的碳硅圈名字已写回海岸")
                    } catch (error: Throwable) {
                        reportFailure("另一位屋主名字保存失败", error)
                    }
                }
            }
        )
    }

    commenting?.let { moment ->
        TextEditDialog("评论", "", onDismiss = { commenting = null }) { text ->
            if (text.isBlank()) onSnackbar("评论还是空的") else scope.launch {
                try {
                    repository.addMomentComment(moment.id, text)
                    onActionLogged("daily.moment.comment", "评论了一条碳硅圈", "海岸新增 1 条屋主评论")
                    commenting = null
                } catch (error: Throwable) { reportFailure("评论写回失败", error) }
            }
        }
    }
    editing?.let { moment ->
        TextEditDialog("编辑动态", moment.text, onDismiss = { editing = null }) { text ->
            if (text.isBlank()) onSnackbar("正文还是空的") else scope.launch {
                try {
                    repository.patchMoment(moment.id, text = text)
                    onActionLogged("daily.moment.edit", "编辑了一条碳硅圈", "海岸更新 1 条动态")
                    onSnackbar("动态已写回海岸")
                    editing = null
                } catch (error: Throwable) { reportFailure("动态更新失败", error) }
            }
        }
    }
    deleting?.let { moment ->
        DailyDeleteConfirmDialog(
            title = "删除这条动态？",
            body = "这是海岸里的正式动态；删除后 PWA 与 Native 都不会再看到它。",
            onDismiss = { deleting = null },
            onConfirm = {
                scope.launch {
                    try {
                        repository.deleteMoment(moment.id)
                        onActionLogged("daily.moment.delete", "删除了一条碳硅圈", "海岸删除 1 条动态")
                        onSnackbar("动态已从海岸删除")
                        deleting = null
                    } catch (error: Throwable) { reportFailure("动态删除失败", error) }
                }
            }
        )
    }
}

@Composable
internal fun MomentComposeScreen(
    repository: DailyRepository,
    onActionLogged: (String, String, String) -> Unit,
    onSnackbar: (String) -> Unit,
    onDone: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var date by remember { mutableStateOf(LocalDate.now().toString().replace('-', '/')) }
    var body by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(horizontal = 28.dp, vertical = 34.dp)) {
        item {
            DailySurfaceCard {
                DailyField("日期", date, { date = it }, "YYYY/MM/DD")
                Spacer(Modifier.height(18.dp))
                DailyField("正文", body, { body = it }, "今天想留什么？", minLines = 10, maxLines = 18)
                Spacer(Modifier.height(18.dp))
                DailyPrimaryButton(if (saving) "正在写回海岸…" else "发布动态") {
                    if (body.isBlank()) {
                        onSnackbar("正文还是空的")
                    } else if (!saving) {
                        saving = true
                        scope.launch {
                            try {
                                val created = repository.createMoment(date, body)
                                onActionLogged("daily.moment.write", "写了一条碳硅圈", "海岸新增 1 条屋主动态")
                                try {
                                    repository.requestModelPartnerComment(created.id)
                                    onActionLogged("daily.moment.myri-comment", "另一位屋主即时留言", "海岸已生成并保存 1 条真实留言")
                                    onSnackbar("动态已发布，另一位屋主也在海岸留下了回复")
                                } catch (commentError: Throwable) {
                                    val detail = if (commentError is CoastApiException) commentError.message else commentError.message ?: "未知错误"
                                    onSnackbar("动态已发布；另一位屋主即时留言暂未完成：$detail")
                                }
                                onDone()
                            } catch (error: Throwable) {
                                val detail = if (error is CoastApiException) error.message else error.message ?: "未知错误"
                                onSnackbar("动态发布失败：$detail")
                            } finally { saving = false }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MomentCard(
    moment: DailyMoment,
    avatarUri: String,
    avatarFallback: String,
    authorLabel: String,
    myriDisplayName: String,
    authorEditable: Boolean,
    myriCommentBusy: Boolean,
    onEditModelPartnerName: () -> Unit,
    onLike: () -> Unit,
    onComment: () -> Unit,
    onModelPartnerComment: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val modelUsage = momentModelUsage(moment)
    DailySurfaceCard {
        Row {
            DailyAvatar(avatarUri, avatarFallback)
            Spacer(Modifier.size(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    authorLabel,
                    modifier = if (authorEditable) Modifier.clickable(onClick = onEditModelPartnerName).padding(vertical = 2.dp) else Modifier,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(6.dp))
                Text(moment.text, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Normal))
                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .62f), thickness = .5.dp)

                if (moment.comments.isNotEmpty()) {
                    Spacer(Modifier.height(9.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        moment.comments.takeLast(5).forEach { comment ->
                            val commentAuthor = if (comment.author == "xiaohan") "屋主" else myriDisplayName.ifBlank { "另一位屋主" }
                            Text(
                                text = buildAnnotatedString {
                                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(commentAuthor) }
                                    append("：")
                                    append(comment.text)
                                },
                                modifier = if (comment.author != "xiaohan") Modifier.clickable(onClick = onEditModelPartnerName) else Modifier,
                                color = MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Normal)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(if (moment.comments.isEmpty()) 9.dp else 12.dp))
                MomentActionRows(
                    moment = moment,
                    footer = momentFooter(moment),
                    myriCommentBusy = myriCommentBusy,
                    onLike = onLike,
                    onComment = onComment,
                    onModelPartnerComment = onModelPartnerComment,
                    onEdit = onEdit,
                    onDelete = onDelete
                )
                if (modelUsage.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Text(
                            modelUsage,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .68f),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.Normal)
                        )
                    }
                }
            }
        }
    }
}

private fun momentAuthorLabel(moment: DailyMoment, myriDisplayName: String): String = when {
    moment.isHumanOwner -> moment.displayAuthor.ifBlank { "屋主" }
    moment.author == "api" || moment.author == "myri" -> myriDisplayName.ifBlank { "另一位屋主" }
    else -> moment.displayAuthor.ifBlank { moment.author }
}

private fun momentModelUsage(moment: DailyMoment): String {
    val latestModelPartner = moment.comments.asReversed().firstOrNull {
        it.author != "xiaohan" && !it.modelId.isNullOrBlank()
    }
    val model = latestModelPartner?.modelId?.takeIf(String::isNotBlank) ?: moment.modelLabel?.takeIf(String::isNotBlank) ?: return ""
    val usage = latestModelPartner?.usage
    val total = usage?.totalTokens
    val tokenPart = when {
        total != null -> "${compactTokens(total)} tokens"
        usage?.promptTokens != null || usage?.completionTokens != null ->
            "in ${compactTokens(usage?.promptTokens ?: 0)} / out ${compactTokens(usage?.completionTokens ?: 0)}"
        else -> ""
    }
    return listOf(modelDisplayName(model), tokenPart).filter(String::isNotBlank).joinToString(" · ")
}

private fun compactTokens(value: Long): String = when {
    value < 1_000 -> value.toString()
    value < 10_000 -> String.format(java.util.Locale.US, "%.1fk", value / 1_000.0)
    else -> "${value / 1_000}k"
}

private fun momentFooter(moment: DailyMoment): String {
    val clock = runCatching {
        DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(moment.createdAt))
    }.getOrDefault("")
    val date = runCatching { LocalDate.parse(moment.date).format(DateTimeFormatter.ofPattern("MM月dd日")) }.getOrDefault(moment.date)
    val likes = if (moment.likeCount > 0) " · ${moment.likeCount} 赞" else ""
    return (if (clock.isBlank()) date else "$date · $clock") + likes
}

@Composable
private fun ModelPartnerNameDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var value by remember(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("碳硅圈里的名字") },
        text = {
            BasicTextField(
                value = value,
                onValueChange = { value = it.replace('\n', ' ').take(80) },
                modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp)).padding(12.dp),
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                singleLine = true
            )
        },
        confirmButton = { TextButton(onClick = { onSave(value.trim().ifBlank { "另一位屋主" }) }) { Text("保存") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
internal fun TextEditDialog(title: String, initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var value by remember(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            BasicTextField(
                value,
                { value = it },
                modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp)).padding(12.dp),
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                minLines = 3,
                maxLines = 8
            )
        },
        confirmButton = { TextButton(onClick = { onSave(value) }) { Text("保存") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
internal fun SmallButton(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 11.dp, vertical = 8.dp),
        style = MaterialTheme.typography.labelLarge
    )
}

@Composable
internal fun QuietDailyCard(content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(22.dp)).padding(17.dp)) { content() }
}
