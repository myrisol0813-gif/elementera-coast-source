package com.elementeracoast.app.feature.shell

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.elementeracoast.app.ui.theme.SnowLetterSurface
import com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.PopupProperties
import com.elementeracoast.app.core.model.RoomType

data class FeatureGuide(val title: String, val body: String, val localNote: String = "")

internal val LocalOpenGuideManual = staticCompositionLocalOf<() -> Unit> { {} }

internal object FeatureGuides {
    val memory = FeatureGuide("记忆库", "侧栏 → 记忆 → 记忆库。右上角新增：手动保存记忆；待确认区：接收模型候选；搜索与分类：查找已有记忆。开启召回后按相关性取回，不会每轮递入整个记忆库。", "本机内置语义模型，结合关键词召回；索引尚未就绪时仍可使用关键词。无需配置向量 API。")
    val seeds = FeatureGuide("种子库", "侧栏 → 记忆 → 种子库。右上角新增：保存值得继续发展的想法、问题与意象，填写适合重新拾起它们的时机。种子不代表已发生的事实。")
    val pending = FeatureGuide("待确认区", "记忆页面 → 待确认区：查看模型提出的长期资料候选，选择去处、确认、编辑后确认或驳回。未确认内容不作为正式记忆召回。")
    val userPortrait = FeatureGuide("用户画像", "记忆页面 → 用户画像：查看模型对用户的长期认识及修改建议。正式正文参与上下文，候选确认后生效。")
    val selfPortrait = FeatureGuide("自我画像", "记忆页面 → 自我画像：查看模型对自身的长期认识及修改建议。正式正文参与上下文，候选确认后生效。")
    val instructions = FeatureGuide("自定义指令", "记忆页面 → 自定义指令：填写希望模型长期参考的背景、表达方式与约定。不必放入所有历史对话。")
    val worldbook = FeatureGuide("世界书 / 词典", "记忆页面 → 世界书。右上角新增：添加人物、地点、专有名词及设定，设置关键词、适用范围与常驻规则。使用命中测试检查是否匹配。")
    val soil = FeatureGuide("整理当前对话的纸条", "聊天右上角 ···：开启或关闭自动整理。回复结束后由模型整理当前内容、余思及长期候选；当前纸条与余思供下一轮承接。关闭后保留旧纸条，停止整理及递入。点击消息对应的历史纸条可回看或收藏。", "本机使用当前选中的模型整理。")
    val desk = FeatureGuide("本轮上下文预览", "对话框右侧尖角：展开屋主抽屉，打开本轮上下文预览，查看实际递入的资料、工具回执及预算。尚无回执时先完成一轮对话。")
    val window = FeatureGuide("这个窗口", "聊天右上角 ···：设置现实上下文、短句模式、纸条整理与新居信，仅对当前窗口生效。", "在这里也可设置跨窗口回忆、本机模型工具与本机模型写入。")
    val drawer = FeatureGuide("屋主抽屉", "对话框右侧尖角：打开屋主抽屉。可填写私人草稿、选取其他窗口的历史消息并查看本轮上下文。手动选取资料仅本轮生效。")
    val letter = FeatureGuide("新居信", "右上角 ··· → 新居信：为当前窗口与模型写下相处背景、想法或希望继续探索的内容。可保存草稿，在支持的模式下递出并由模型阅读。")
    val models = FeatureGuide("模型箱", "屋主设置 → 模型箱：配置并选择聊天模型。前后端模式使用已部署后端的模型。", "本机可选择已授权的 ChatGPT 套餐通道或兼容 API 供应商。费用与额度以供应商为准，Key 不随归档导出。")
    val codex = FeatureGuide("Codex 额度", "屋主设置 → 模型箱：选择套餐通道，管理 ChatGPT 账户授权及可用模型；实际额度与模型以账户服务为准。")
    val provider = FeatureGuide("自有供应商", "屋主设置 → 模型箱：填写兼容供应商的 HTTPS API 地址及 Key，获取或添加模型 ID 后选择使用。生成可能产生费用，Key 不随归档导出。")
    val calendar = FeatureGuide("日历与纪念日", "小组件 → 日历：记录日程、随记与纪念日，填写标题、起始日期及计算方式。开启侧栏展示后可从侧栏查看和编辑。")
    val daily = FeatureGuide("小组件", "侧栏 → 小组件：前往碳硅圈、日记、日历、文件库及书房。")
    val moments = FeatureGuide("碳硅圈", "小组件 → 碳硅圈。右上角「+ 动态」：发表文字、图片，参与评论和点赞。支持工具且获授权的模型也可参与。", "要让模型在聊天中发表或评论，先在当前窗口开启本机模型工具及本机模型写入。")
    val diary = FeatureGuide("日记", "小组件 → 日记。右上角「+ 日记」：记录文字、天气、心情与标签，按日期翻阅。", "模型写日记需要当前窗口写入权限。")
    val vault = FeatureGuide("文件库与收藏", "小组件 → 文件库。基本文件库：分类查看图片、语音及附件，返回来源。收藏：收存文字、纸条与媒体，可添加备注、搜索、取消收藏；原件仍保留。")
    val library = FeatureGuide("书房", "小组件 → 书房。书架右上角「+」：导入 EPUB / TXT；点开书籍阅读、保存进度、划线、批注及读后感。暂不支持 PDF。删除整本书也会删除关联笔记。", "模型共读前先开启当前窗口的本机模型工具；留下笔记还需写入权限。")
    val readTools = FeatureGuide("本机模型工具", "聊天右上角 ··· → 这个窗口 → 本机模型工具：允许模型按需读取已支持的本机资料，默认关闭、逐窗口生效。读取不等于写入。")
    val writeTools = FeatureGuide("本机模型写入", "聊天右上角 ··· → 这个窗口 → 本机模型写入：允许已支持的新增操作，例如动态、日记、批注、候选。默认关闭、逐窗口生效。正式记忆仍需确认；不能修改或删除屋主资料。")
    val tools = FeatureGuide("模型工作台 / MCP 工具", "侧栏 → 模型工作台：查看已配置工具与执行记录。模型必须支持工具调用并获得相应授权。正文声称完成不等于真实执行，以工具回执为准。", "本机外部连接器及自定义 MCP 客户端尚未接入。")
    val backup = FeatureGuide("聊天记录与迁移", "屋主设置 → 聊天记录。导出：生成可恢复的 ZIP 归档；导出 HTML：生成阅读副本；导入：先预览再确认。恢复范围以归档清单为准，密钥及登录凭据需另行配置。卸载前将本机备份保存到应用外。")
    val settings = FeatureGuide("屋主设置", "侧栏底部 → 屋主设置：个人资料、外观、账户、模型、聊天设置、归档、更新与使用手册。")
    val profile = FeatureGuide("个人资料", "屋主设置 → 个人资料：修改昵称、署名等显示资料，不改变已有记录的实际作者。")
    val appearance = FeatureGuide("外观", "屋主设置 → 外观：调整主题、纸页、字体及重点色，不改变对话内容。")
    val account = FeatureGuide("账户", "屋主设置 → 账户：查看登录状态或返回开屏切换模式。本机和前后端资料独立保存，不自动同步；外部模型仍需网络。")
    val basic = FeatureGuide("基本设置", "屋主设置 → 基本设置：调整最近聊天轮数、上下文预算及生成偏好。自动预算依据模型目录容量预留空间，未知时采用18000的舒服区间；手动可自行填写。实际输入与输出仍受供应商限制。")
    val diagnostics = FeatureGuide("关于与诊断", "屋主设置 → 关于与诊断：查看版本及运行状态，辅助定位异常。")
    val update = FeatureGuide("版本与更新", "屋主设置 → 版本与更新：检查正式发行，下载后校验 SHA-256、包名、版本和签名，正常更新可覆盖安装。")

    val reality = FeatureGuide("现实上下文", "右上角 ··· → 这个窗口 → 现实上下文：选择允许读取的现实信息。只有开启且成功取得的信息会递给模型。")
    val shortReply = FeatureGuide("短句模式", "右上角 ··· → 这个窗口 → 短句模式：普通闲聊优先简短回应，深度话题仍可自然展开。")
    val history = FeatureGuide("历史纸条", "回到聊天，点击有纸条的历史消息下方入口，查看对应轮次的整理内容，也可收藏其中的文字。")
    val draft = FeatureGuide("私人草稿", "输入框右侧尖角 → 屋主抽屉 → 私人草稿：填写尚未说出口的内容，选择阅读方式。保存草稿不等于授权模型读取。")
    val cross = FeatureGuide("跨窗口回忆", "输入框右侧尖角 → 屋主抽屉 → 跨窗口读取：选取历史消息。允许模型自主检索的开关位于当前窗口设置；不会由手册自动开启。")
    val echo = FeatureGuide("模型回波", "聊天消息下方的模型回波：查看模型与实际返回的运行信息。预算、估算和供应商实际用量不是同一个数值。")
    val collection = FeatureGuide("收藏", "小组件 → 文件库 → 收藏：浏览保存的文字、纸条、图片、语音与附件，可搜索、添加备注并返回来源。取消收藏不删除原件。")
    val pets = FeatureGuide("宠物系统", "小组件 → 宠物系统：仍在准备，目前没有可用的养成操作。")
    val attachments = FeatureGuide("附件", "输入框左侧加号：选择图片或文件，发送前可以移除。每轮最多12个；实际递入情况在本轮上下文预览中查看。", "本机支持 PNG、JPEG、WebP 与 UTF-8 文本读取；图片已递入不代表模型已经识别。")
    val toolLog = FeatureGuide("工具调用记录", "侧栏 → 模型工作台：检查工具调用及成功或失败的回执。未授权、模型不支持工具和执行失败是不同情况。")

    fun room(type: RoomType, local: Boolean): FeatureGuide = when (type) {
        RoomType.Main -> FeatureGuide("主聊天室", "与所选模型日常对话的空间。\n顶部模型名称：选择模型。\n右上角 ···：设置现实上下文、短句模式、纸条整理与新居信。\n输入框右侧尖角：打开屋主抽屉，查看本轮上下文预览。\n输入框左侧加号：添加图片及文件。\n侧栏搜索：查找窗口与历史原文。", if (local) "需要模型读写本机资料时，右上角 ··· → 这个窗口 → 本机模型工具 / 本机模型写入；两个权限默认关闭、仅对当前窗口生效。" else "")
        RoomType.Radio -> FeatureGuide("共通聊天室", "侧栏 → 共通聊天室：通过已配置的 MCP 让 ChatGPT 官端与 API 模型交流。", if (local) "本机模式暂不支持该连接。" else "")
        RoomType.Lighthouse -> FeatureGuide("MCP 对话区", "侧栏 → MCP 对话区：与已连接的 ChatGPT 交换消息。", if (local) "本机模式暂不支持该连接。" else "")
    }

    fun manual(local: Boolean): List<GuideEntry> = listOf(
        GuideEntry("main", room(RoomType.Main, local), "聊天与上下文"),
        GuideEntry("radio", room(RoomType.Radio, local), "聊天与上下文", !local),
        GuideEntry("lighthouse", room(RoomType.Lighthouse, local), "聊天与上下文", !local),
        GuideEntry("window", window, "聊天与上下文"),
        GuideEntry("reality", reality, "聊天与上下文"),
        GuideEntry("short", shortReply, "聊天与上下文"),
        GuideEntry("drawer", drawer, "聊天与上下文"),
        GuideEntry("draft", draft, "聊天与上下文"),
        GuideEntry("cross", cross, "聊天与上下文"),
        GuideEntry("soil", soil, "聊天与上下文"),
        GuideEntry("desk", desk, "聊天与上下文"),
        GuideEntry("history", history, "聊天与上下文"),
        GuideEntry("echo", echo, "聊天与上下文"),
        GuideEntry("attachments", attachments, "聊天与上下文"),
        GuideEntry("letter", letter, "聊天与上下文"),
        GuideEntry("memory", memory, "记忆与长期资料"),
        GuideEntry("seeds", seeds, "记忆与长期资料"),
        GuideEntry("pending", pending, "记忆与长期资料"),
        GuideEntry("userPortrait", userPortrait, "记忆与长期资料"),
        GuideEntry("selfPortrait", selfPortrait, "记忆与长期资料"),
        GuideEntry("worldbook", worldbook, "记忆与长期资料"),
        GuideEntry("instructions", instructions, "记忆与长期资料"),
        GuideEntry("daily", daily, "日常与资料"),
        GuideEntry("moments", moments, "日常与资料"),
        GuideEntry("diary", diary, "日常与资料"),
        GuideEntry("calendar", calendar, "日常与资料"),
        GuideEntry("vault", vault, "日常与资料"),
        GuideEntry("collection", collection, "日常与资料"),
        GuideEntry("library", library, "日常与资料"),
        GuideEntry("pets", pets, "日常与资料"),
        GuideEntry("models", models, "模型与工具"),
        GuideEntry("codex", codex, "模型与工具", local),
        GuideEntry("provider", provider, "模型与工具", local),
        GuideEntry("readTools", readTools, "模型与工具", local),
        GuideEntry("writeTools", writeTools, "模型与工具", local),
        GuideEntry("tools", tools, "模型与工具"),
        GuideEntry("toolLog", toolLog, "模型与工具"),
        GuideEntry("settings", settings, "屋主设置与迁移"),
        GuideEntry("profile", profile, "屋主设置与迁移"),
        GuideEntry("appearance", appearance, "屋主设置与迁移"),
        GuideEntry("account", account, "屋主设置与迁移"),
        GuideEntry("basic", basic, "屋主设置与迁移"),
        GuideEntry("backup", backup, "屋主设置与迁移"),
        GuideEntry("diagnostics", diagnostics, "屋主设置与迁移"),
        GuideEntry("update", update, "屋主设置与迁移")
    )

}

internal data class GuideEntry(val key: String, val guide: FeatureGuide, val group: String, val available: Boolean = true)

@Composable
internal fun FeatureManual(local: Boolean, onDismiss: () -> Unit, onNavigate: (String) -> Unit) {
    val sections = remember(local) { FeatureGuides.manual(local).groupBy { it.group } }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            Column {
                FeaturePageTopBar("使用手册", "按页面查找功能及操作入口", onBack = onDismiss)
                LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    sections.forEach { (group, entries) ->
                        item { Text(group, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        items(entries, key = { it.key }) { entry ->
                            SnowLetterSurface(
                                modifier = Modifier.fillMaxWidth(),
                                role = SnowLetterSurfaceRole.StatusCard,
                                fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                                fallbackShape = RoundedCornerShape(18.dp)
                            ) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(entry.guide.title, style = MaterialTheme.typography.titleSmall)
                                    Text(entry.guide.body + if (local && entry.guide.localNote.isNotBlank()) "\n\n" + entry.guide.localNote else "", style = MaterialTheme.typography.bodySmall)
                                    if (entry.available) TextButton(onClick = { onNavigate(entry.key) }) { Text("前往对应入口") }
                                    else Text("当前模式不可用", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun FeatureGuideButton(guide: FeatureGuide, firstLocalHint: Boolean = false) {
    val context = LocalContext.current
    val prefs = remember(context) { context.applicationContext.getSharedPreferences("coast_feature_hints", Context.MODE_PRIVATE) }
    var hint by remember(firstLocalHint) { mutableStateOf(firstLocalHint && !prefs.getBoolean("manual_help_seen", false)) }
    var open by remember(guide) { mutableStateOf(false) }
    val openManual = LocalOpenGuideManual.current
    fun dismissHint() { hint = false; prefs.edit().putBoolean("manual_help_seen", true).apply() }
    val outline = MaterialTheme.colorScheme.primary
    Box {
        IconButton(onClick = { if (hint) dismissHint(); open = true }, modifier = Modifier.size(30.dp).drawBehind {
            if (hint) {
                val inset = 1.dp.toPx()
                drawRoundRect(outline, topLeft = Offset(inset,inset), size = Size(size.width - inset*2,size.height - inset*2),
                    cornerRadius = CornerRadius(7.dp.toPx()), style = Stroke(width=1.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(),3.dp.toPx()))))
            }
        }) { Text("?", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall) }
        if (hint) {
            val offset = with(LocalDensity.current) { 34.dp.roundToPx() }
            Popup(alignment = Alignment.TopEnd, offset = IntOffset(0, offset), onDismissRequest = { dismissHint() },
                properties = PopupProperties(focusable = false)) {
                SnowLetterSurface(
                    modifier = Modifier.widthIn(max = 270.dp),
                    role = SnowLetterSurfaceRole.StatusCard,
                    fallbackColor = MaterialTheme.colorScheme.surfaceVariant,
                    fallbackShape = RoundedCornerShape(18.dp)
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("每个页面都有自己的使用说明，点击右上角的问号即可查看。也可以先翻翻完整的使用手册。", style = MaterialTheme.typography.bodySmall)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { dismissHint() }) { Text("知道了") }
                            TextButton(onClick = { dismissHint(); openManual() }) { Text("看看说明书") }
                        }
                    }
                }
            }
        }
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(guide.title) },
        text = { Text(guide.body + if (com.elementeracoast.app.core.local.NativeWorkspace.isLocal && guide.localNote.isNotBlank()) "\n\n" + guide.localNote else "", modifier = Modifier.verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton(onClick = { open = false }) { Text("知道了") } },
        dismissButton = { TextButton(onClick = { open = false; openManual() }) { Text("完整手册") } })
}
