package com.elementeracoast.app.feature.shell

import android.content.Context
import androidx.compose.foundation.layout.*
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

internal object FeatureGuides {
    val memory = FeatureGuide("记忆库", "保存相处中形成的长期记忆。可手动添加，也可确认模型提出的记忆候选，供后续对话使用。\n\n对话 → 记忆候选 → 确认 → 正式记忆", "本机整理已开启时可生成候选。")
    val seeds = FeatureGuide("种子库", "保存值得继续生长的意象、认知与灵感。添加内容及使用时机，为未来对话提供线索。", "")
    val userPortrait = FeatureGuide("用户画像", "保存模型对用户逐渐形成的长期认识。开启自动整理后，可确认模型提出的修改建议，更新正式正文。", "本机整理已开启时可生成候选。")
    val selfPortrait = FeatureGuide("自我画像", "保存模型对自身逐渐形成的认识。开启自动整理后，可确认模型提出的修改建议，更新正式正文。", "本机整理已开启时可生成候选。")
    val instructions = FeatureGuide("自定义指令", "填写希望模型长期参考的背景、表达方式与要求，保存后随对话上下文递入模型。", "")
    val pending = FeatureGuide("待确认区", "查看模型提出的长期资料整理建议，可确认、编辑后确认或驳回。", "")
    val worldbook = FeatureGuide("世界书 / 词典", "保存人物、地点、专有名词与背景设定。添加词条，设置关键词及适用范围；命中关键词或启用常驻时，可将对应内容递给模型。\n\n添加词条 → 匹配或常驻 → 递入上下文", "")
    val soil = FeatureGuide("思维壤", "保存当前窗口中需要继续承接的内容。开启自动整理后，每轮整理纸条，供下一轮使用。关闭后保留旧纸条，暂停整理与递入。\n\n当前对话 → 整理纸条 → 下一轮上下文", "本机使用当前选中的模型自动整理；关闭时保留旧纸条。")
    val desk = FeatureGuide("本轮桌面", "查看本轮实际递入的上下文与回执，了解模型读取了哪些资料。", "")
    val models = FeatureGuide("模型箱", "配置与选择用于对话的模型。本机可连接支持的 ChatGPT 账户通道，或填写兼容供应商的 HTTPS API 地址、Key 与模型 ID。前后端模式使用已部署后端提供的模型。\n\n连接供应商 → 选择模型 → 发送消息\n\n额度与费用由供应商决定，Key 不随归档导出。", "")
    val calendar = FeatureGuide("日历与纪念日", "记录日常事件与纪念日。新建纪念日时填写标题、起始日期和计算方式；开启侧栏展示即可在侧栏查看及编辑。起始日算第 1 天。", "")
    val daily = FeatureGuide("小组件", "记录日常片段，可进入碳硅圈、日记或日历查看及编辑。", "")
    val moments = FeatureGuide("碳硅圈", "分享日常、照片与随手写下的想法，保存生活中的片段。", "")
    val diary = FeatureGuide("日记", "记录每天的经历、感受与思考，随时按日期回看。", "")
    val vault = FeatureGuide("文件库与拾潮", "基本文件库：归集聊天中的图片、语音与附件，可分类查看和返回来源。\n\n拾潮：收藏文字与媒体，可添加备注、搜索或取消收藏。取消收藏会保留原聊天内容。", "")
    val library = FeatureGuide("潮中书房", "导入支持的电子书，阅读章节、添加书签和批注，并保留阅读进度。", "")
    val backup = FeatureGuide("聊天记录与迁移", "导出：生成可恢复的 ZIP 归档，用于备份与迁移。\n\n导出 HTML：生成阅读副本。\n\n导入：选择归档，预览并确认需要恢复的资料。\n\n卸载前请将本机归档保存到应用外目录。密钥及登录凭据需单独配置。", "")
    val settings = FeatureGuide("屋主设置", "管理外观、个人资料、模型配置、聊天记录与应用设置。可通过账户页面返回开屏，切换本机或前后端模式；两种模式分别保存资料。", "")
    val tools = FeatureGuide("模型工作台 / MCP 工具", "配置并启用工具后，支持工具调用的模型可按需读取资料或执行操作。执行结果可在工具记录中查看。\n\n启用工具 → 模型调用 → 执行 → 返回结果", "本机可在「这个窗口」分别授权读取与写入工具，支持日常、日历、书房及记忆候选等操作；外部连接尚未接入。")

    fun room(type: RoomType, local: Boolean): FeatureGuide = when(type) {
        RoomType.Main -> FeatureGuide("主聊天室", "与 API 模型日常对话的空间。选择模型后即可聊天。\n\n右上角 ···\n现实上下文：递入已启用的设备现场信息。\n短句模式：闲聊时优先简短回复。\n整理当前对话的纸条：每轮整理，为下一轮提供语境。\n登岛信：补充当前窗口的初始背景。\n\n屋主抽屉\n私人草稿：补充此刻的心情与想法。\n跨窗口选取：将指定旧消息递入本轮。\n历史消息搜索：按关键词寻找过去的对话。" + if(local) "\n\n本机可在「这个窗口」开启跨窗口回忆，由模型决定是否检索。手动选取仅本轮有效。" else "")
        RoomType.Radio -> FeatureGuide("共通聊天室", "GPT 官端与海岸 API 模型的共通对话区。连接 MCP 后，可在官端与海岸之间继续对话。\n\n如无需要，可忽略。" + if(local) "\n本机暂不支持官端 MCP 连接。" else "")
        RoomType.Lighthouse -> FeatureGuide("MCP 对话区", "与 GPT 官端通过 MCP 交换消息的对话区。在此发送消息，由官端读取并回复。\n\n如无需要，可忽略。" + if(local) "\n本机暂不支持官端 MCP 连接。" else "")
    }
}

@Composable
internal fun FeatureGuideButton(guide: FeatureGuide, firstLocalHint: Boolean = false) {
    val context = LocalContext.current
    val prefs = remember(context) { context.applicationContext.getSharedPreferences("coast_feature_hints", Context.MODE_PRIVATE) }
    var hint by remember(firstLocalHint) { mutableStateOf(firstLocalHint && !prefs.getBoolean("local_help_seen", false)) }
    var open by remember(guide) { mutableStateOf(false) }
    fun dismissHint() { hint = false; prefs.edit().putBoolean("local_help_seen", true).apply() }
    val outline = MaterialTheme.colorScheme.primary
    Box {
        IconButton(onClick = { if (hint) dismissHint(); open = true }, modifier = Modifier.size(30.dp).drawBehind {
            if (hint) {
                val inset = 1.dp.toPx()
                drawRoundRect(outline, topLeft = Offset(inset,inset), size = Size(size.width - inset*2,size.height - inset*2),
                    cornerRadius = CornerRadius(7.dp.toPx()), style = Stroke(width=1.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(),3.dp.toPx()))))
            }
        }) { Text("?", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall) }
        DropdownMenu(expanded = hint, onDismissRequest = { dismissHint() }, properties = PopupProperties(focusable = false)) {
            Column(Modifier.widthIn(max = 230.dp).padding(horizontal = 14.dp, vertical = 7.dp)) {
                Text("各个页面都有自己的使用说明，遇到不懂的地方，可以点击右上角的问号。", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { dismissHint() }, modifier = Modifier.align(Alignment.End)) { Text("知道了") }
            }
        }
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(guide.title) },
        text = { Text(guide.body + if (com.elementeracoast.app.core.local.NativeWorkspace.isLocal && guide.localNote.isNotBlank()) "\n\n" + guide.localNote else "", modifier = Modifier.verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton(onClick = { open = false }) { Text("知道了") } })
}
