package com.elementeracoast.app.feature.wolf

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.Role
import com.elementeracoast.app.ui.theme.CoastThemePreset
import com.elementeracoast.app.ui.theme.CoastFontMode
import com.elementeracoast.app.ui.theme.CoastPaperMode
import com.elementeracoast.app.ui.theme.CoastReadingWeight
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import java.io.File

@Composable
internal fun ProfileScreen(
    state: WolfState,
    store: WolfStore,
    onAppearance: () -> Unit,
    onSnackbar: (String) -> Unit
) {
    var nickname by remember(state.profile.nickname) { mutableStateOf(state.profile.nickname) }
    var signature by remember(state.profile.signature) { mutableStateOf(state.profile.signature) }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        item {
            Text("个人资料", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "这些显示资料不会自动进入 模型伙伴 的记忆或系统提示词。真正长期参与理解的内容仍属于自定义指令或记忆库。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
        item { WolfTextField("昵称", nickname, { nickname = it }) }
        item { WolfTextField("聊天署名 / 导出显示名", signature, { signature = it }) }
        item { WolfRow("用户气泡颜色", "复用外观里的同一项设置", onAppearance) }
        item {
            PrimaryLocalButton("保存个人资料") {
                store.saveProfile(nickname, signature)
                onSnackbar("个人资料已保存在本机")
            }
        }
    }
}

@Composable
internal fun AppearanceScreen(state: WolfState, store: WolfStore, onSnackbar: (String) -> Unit) {
    val context = LocalContext.current
    val localFontLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching { importLocalFont(context, uri) }
            .onSuccess { imported ->
                store.setLocalFont(imported.displayName, imported.path)
                onSnackbar("本机字体已导入：${imported.displayName}")
            }
            .onFailure { error -> onSnackbar(error.message ?: "本机字体导入失败") }
    }
    val chatBackgroundLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching { importChatBackground(context, uri) }
            .onSuccess { imported ->
                store.setChatBackground(imported.displayName, imported.path)
                onSnackbar("聊天背景已保存到本机：${imported.displayName}")
            }
            .onFailure { error -> onSnackbar(error.message ?: "聊天背景导入失败") }
    }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
        item { Text("外观", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        item {
            SettingGroup("主题衣柜") {
                CoastThemePreset.entries.forEach { preset ->
                    ChoiceRow("${preset.label}｜${preset.tag}", state.appearance.theme == preset) {
                        store.setTheme(preset)
                        onSnackbar("主题已切换为${preset.label}")
                    }
                }
            }
        }
        item {
            SettingGroup("用户气泡颜色") {
                listOf("" to "默认 · 跟随主题", "#eaf0f7" to "冷蓝灰", "#f5e8ee" to "浅粉灰", "#f1ead8" to "淡金灰").forEach { (value, label) ->
                    ChoiceRow(label, state.appearance.userBubbleHex == value) { store.setUserBubble(value) }
                }
            }
        }
        item {
            SettingGroup("重点色") {
                listOf("" to "默认 · 跟随主题", "#ff6a21" to "橙色", "#f28b2e" to "金色", "#3b82f6" to "蓝色", "#ec4899" to "粉色").forEach { (value, label) ->
                    ChoiceRow(label, state.appearance.accentHex == value) { store.setAccent(value) }
                }
            }
        }
        item {
            SettingGroup("消息底透明度 · 双方消息") {
                Text(
                    "当前：${(state.appearance.messageSurfaceAlpha * 100).toInt()}%",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                Slider(
                    value = state.appearance.messageSurfaceAlpha,
                    onValueChange = store::setMessageSurfaceAlpha,
                    valueRange = .55f..1f
                )
                Text(
                    "用户气泡和模型纸底共用这一项。最低保留 55%，避免长文被背景吃掉。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        item {
            SettingGroup("聊天背景图 · 本机 APK") {
                if (state.appearance.chatBackgroundImagePath.isNotBlank()) {
                    ChatBackgroundPreview(
                        path = state.appearance.chatBackgroundImagePath,
                        dimAlpha = state.appearance.chatBackgroundDimAlpha
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        state.appearance.chatBackgroundImageName.ifBlank { "已保存本机背景图" },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                    ChoiceRow("更换背景图", false, "只保存在此设备，不上传后端") {
                        chatBackgroundLauncher.launch(arrayOf("image/png", "image/jpeg", "image/webp"))
                    }
                    ChoiceRow("移除背景图", false, "删除 APP 私有目录里的背景副本") {
                        removeChatBackground(context, state.appearance.chatBackgroundImagePath)
                        store.clearChatBackground()
                        onSnackbar("聊天背景已移除")
                    }
                    Text(
                        "背景柔化：${(state.appearance.chatBackgroundDimAlpha * 100).toInt()}%",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall
                    )
                    Slider(
                        value = state.appearance.chatBackgroundDimAlpha,
                        onValueChange = store::setChatBackgroundDimAlpha,
                        valueRange = 0f..0.65f
                    )
                } else {
                    ChoiceRow("选择背景图", false, "使用系统相册选择，按聊天区比例填充裁剪预览") {
                        chatBackgroundLauncher.launch(arrayOf("image/png", "image/jpeg", "image/webp"))
                    }
                }
            }
        }
        item {
            SettingGroup("聊天正文字体 · 双方消息") {
                CoastFontMode.entries.forEach { mode ->
                    if (mode == CoastFontMode.CustomLocal) {
                        val imported = state.appearance.localFontPath.isNotBlank()
                        ChoiceRow(
                            label = mode.label,
                            selected = state.appearance.fontMode == mode,
                            subtitle = if (imported) state.appearance.localFontName.ifBlank { "已导入本机字体" } else "点此选择已购买或授权的 .ttf / .otf"
                        ) {
                            if (imported) store.setFontMode(mode) else localFontLauncher.launch(arrayOf("font/ttf", "font/otf", "application/x-font-ttf", "application/x-font-otf", "application/octet-stream"))
                        }
                        if (imported) {
                            ChoiceRow("更换本机字体", false, "重新选择 .ttf / .otf，只保存在此设备") {
                                localFontLauncher.launch(arrayOf("font/ttf", "font/otf", "application/x-font-ttf", "application/x-font-otf", "application/octet-stream"))
                            }
                            ChoiceRow("移除本机字体", false, "删除 APP 私有目录里的字体副本") {
                                removeLocalFont(context, state.appearance.localFontPath)
                                store.clearLocalFont()
                                onSnackbar("本机字体已移除，已回到朱雀仿宋")
                            }
                        }
                    } else {
                        val bundledName = when (mode) {
                            CoastFontMode.CoastClassic -> "zhuque_fangsong_regular"
                            CoastFontMode.NanoOldSong -> "nano_old_song_a_regular"
                            CoastFontMode.ChillHuoSong -> "chill_huo_song_regular"
                            CoastFontMode.CustomLocal -> ""
                        }
                        val available = context.resources.getIdentifier(bundledName, "font", context.packageName) != 0
                        val fallback = when (mode) {
                            CoastFontMode.CoastClassic -> "系统宋体"
                            CoastFontMode.NanoOldSong -> "系统黑体"
                            CoastFontMode.ChillHuoSong -> "系统等宽体"
                            CoastFontMode.CustomLocal -> "本机字体"
                        }
                        ChoiceRow(mode.label, state.appearance.fontMode == mode,
                            subtitle = if (available) "已加载此款字库" else "开源版未内置此款字库 · 实际使用$fallback") {
                            store.setFontMode(mode)
                        }
                    }
                }
                Text(
                    "开源版未附带专有字体文件，三个预设现在使用不同的系统字体作为替代；想使用指定字形，请导入有授权的 .ttf / .otf。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        item {
            SettingGroup("聊天正文字重 · 双方消息") {
                CoastReadingWeight.entries.forEach { weight ->
                    ChoiceRow(
                        label = weight.label,
                        selected = state.appearance.readingWeight == weight,
                        subtitle = when (weight) {
                            CoastReadingWeight.Normal -> "默认。最清瘦，也最不容易假加粗。"
                            CoastReadingWeight.Medium -> "稍稍加重。适合过细的字体。"
                            CoastReadingWeight.Bold -> "明显加粗。部分字体可能会被系统假加粗。"
                        }
                    ) { store.setReadingWeight(weight) }
                }
            }
        }
        item {
            SettingGroup("纸页形态") {
                CoastPaperMode.entries.forEach { mode ->
                    ChoiceRow(mode.label, state.appearance.paperMode == mode) {
                        store.setPaperMode(mode)
                    }
                }
                if (state.appearance.paperMode == CoastPaperMode.Cloud) {
                    Row(
                        modifier = Modifier.fillMaxWidth()
                            .toggleable(
                                value = state.appearance.cloudOutlineEnabled,
                                role = Role.Switch,
                                onValueChange = store::setCloudOutlineEnabled
                            )
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("云朵浅描边")
                            Text(
                                "跟随主题颜色；关闭描边后仍保留柔和阴影",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Switch(checked = state.appearance.cloudOutlineEnabled, onCheckedChange = null)
                    }
                }
            }
        }
        item { Text("以上都只保存在本机，不接后端。本机字体与背景图只保存于此设备；覆盖安装会保留，卸载或清除数据后需要重新导入。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
private fun ChatBackgroundPreview(path: String, dimAlpha: Float) {
    val bitmap = remember(path) { runCatching { BitmapFactory.decodeFile(path)?.asImageBitmap() }.getOrNull() }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(118.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(bitmap = bitmap, contentDescription = "聊天背景预览", modifier = Modifier.fillMaxWidth().height(118.dp), contentScale = ContentScale.Crop)
            Box(Modifier.fillMaxWidth().height(118.dp).background(MaterialTheme.colorScheme.background.copy(alpha = dimAlpha.coerceIn(0f, .65f))))
        } else {
            Text("背景图预览失败", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
internal fun WolfTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    minLines: Int = 1
) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(5.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp)).padding(13.dp),
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            minLines = minLines,
            maxLines = if (minLines > 1) 8 else 1
        )
    }
}

@Composable
internal fun SettingGroup(title: String, content: @Composable () -> Unit) {
    SnowLetterSurface(
        modifier = Modifier.fillMaxWidth(),
        role = SnowLetterSurfaceRole.StatusCard,
        fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
        fallbackShape = RoundedCornerShape(22.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
internal fun ChoiceRow(label: String, selected: Boolean, subtitle: String? = null, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp)) {
        Text(if (selected) "●" else "○", color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.padding(horizontal = 5.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(label)
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
internal fun PrimaryLocalButton(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primary, RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(14.dp),
        color = MaterialTheme.colorScheme.onPrimary,
        fontWeight = FontWeight.SemiBold
    )
}

private data class ImportedLocalFont(val displayName: String, val path: String)
private data class ImportedChatBackground(val displayName: String, val path: String)

private fun importLocalFont(context: Context, uri: Uri): ImportedLocalFont {
    val displayName = readDisplayName(context, uri).ifBlank { "本机字体" }.take(120)
    val extension = displayName.substringAfterLast('.', "").lowercase()
    val mime = context.contentResolver.getType(uri).orEmpty().lowercase()
    val targetExtension = when {
        extension == "ttf" || mime.contains("ttf") || mime.contains("truetype") -> "ttf"
        extension == "otf" || mime.contains("otf") || mime.contains("opentype") -> "otf"
        else -> throw IllegalArgumentException("请选择 .ttf 或 .otf 字体文件")
    }
    val directory = File(context.filesDir, "local-fonts").apply { mkdirs() }
    directory.listFiles()?.forEach { it.delete() }
    val temp = File(directory, "reading-font.tmp")
    val target = File(directory, "reading-font.$targetExtension")
    context.contentResolver.openInputStream(uri)?.use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
        ?: throw IllegalArgumentException("无法读取所选字体文件")
    check(temp.length() > 0L) { "字体文件为空" }
    runCatching { Typeface.createFromFile(temp) }
        .getOrElse { throw IllegalArgumentException("字体文件无法被 Android 读取") }
    temp.copyTo(target, overwrite = true)
    temp.delete()
    return ImportedLocalFont(displayName.removeSuffix(".ttf").removeSuffix(".TTF").removeSuffix(".otf").removeSuffix(".OTF"), target.absolutePath)
}

private fun importChatBackground(context: Context, uri: Uri): ImportedChatBackground {
    val displayName = readDisplayName(context, uri).ifBlank { "聊天背景" }.take(120)
    val extension = displayName.substringAfterLast('.', "").lowercase()
    val mime = context.contentResolver.getType(uri).orEmpty().lowercase()
    val targetExtension = when {
        extension in setOf("png", "jpg", "jpeg", "webp") -> if (extension == "jpeg") "jpg" else extension
        mime.contains("png") -> "png"
        mime.contains("webp") -> "webp"
        mime.contains("jpeg") || mime.contains("jpg") -> "jpg"
        else -> throw IllegalArgumentException("请选择 PNG、JPG 或 WEBP 图片")
    }
    val directory = File(context.filesDir, "chat-background").apply { mkdirs() }
    directory.listFiles()?.forEach { it.delete() }
    val temp = File(directory, "background.tmp")
    val target = File(directory, "background.$targetExtension")
    context.contentResolver.openInputStream(uri)?.use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
        ?: throw IllegalArgumentException("无法读取所选背景图")
    check(temp.length() > 0L) { "背景图为空" }
    check(temp.length() <= 12L * 1024L * 1024L) { "背景图超过 12 MB" }
    check(BitmapFactory.decodeFile(temp.absolutePath) != null) { "图片无法被 Android 读取" }
    temp.copyTo(target, overwrite = true)
    temp.delete()
    return ImportedChatBackground(displayName, target.absolutePath)
}

private fun readDisplayName(context: Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) return cursor.getString(index).orEmpty()
    }
    return uri.lastPathSegment.orEmpty()
}

private fun removeLocalFont(context: Context, path: String) {
    runCatching { File(path).delete() }
    runCatching { File(context.filesDir, "local-fonts").listFiles()?.forEach { it.delete() } }
}

private fun removeChatBackground(context: Context, path: String) {
    runCatching { File(path).delete() }
    runCatching { File(context.filesDir, "chat-background").listFiles()?.forEach { it.delete() } }
}
