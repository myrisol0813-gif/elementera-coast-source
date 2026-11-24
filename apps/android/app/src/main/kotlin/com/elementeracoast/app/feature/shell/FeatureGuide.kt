package com.elementeracoast.app.feature.shell

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

data class FeatureGuide(val title: String, val body: String)

internal object FeatureGuides {
    val rooms = FeatureGuide("聊天入口", "主聊天用于普通对话；共通聊天室有独立窗口和思维壤，可通过已授权的官端 MCP 写入文字，也可在前端选择模型回复。MCP 对话区用于与已连接 MCP 的外部会话交换文字；在前端发送只保存文字，不自动请求模型回复。三个房间不是三个模型，也不是访客信箱。本机模式没有官端 MCP 连接。")
    val memory = FeatureGuide("记忆与种子", "记忆库保存已经确认的长期记录；种子库保存仍可生长的意象，不等于确认事实。待确认区的候选需要确认后才进入正式库。用户画像和自我画像分别记录对用户和自身的长期认识；自定义指令独立保存。联网模式由后端管理，本机模式尚未接入这些长期记忆能力。")
    val worldbook = FeatureGuide("世界书 / 词典", "新增专有名词及关键词，设置适用范围。命中关键词时，相关词条才进入模型上下文；不是把整本词典每轮都发给模型。联网模式使用后端记录，本机模式尚未接入。")
    val soil = FeatureGuide("思维壤与本轮上下文", "思维壤属于当前窗口，用于整理仍需承接的内容；关闭自动整理后保留旧内容，但不再自动整理或递入。待确认区负责把候选交给屋主确认。本轮上下文预览显示实际递给模型的内容。完整能力需要联网后端，本机模式目前只提供近期文字上下文。")
    val models = FeatureGuide("模型箱", "从聊天顶栏或屋主设置进入模型箱。Android 本机模式可连接 ChatGPT 套餐，或添加自己的 HTTPS OpenAI-compatible 供应商、Key 和模型 ID；两者分开选择。刷新目录后选模型，真实发送才会产生模型请求。Key 不进入普通导出。联网模式使用自己的后端配置，PWA 暂无 Android 本机供应商功能。模型可用性、额度与费用由供应商决定。")
    val calendar = FeatureGuide("日历与纪念日", "日历新增记录时选择纪念日，填写起始日期、标题和计算方式：累计天数、第 N 天倒数或周年倒数。起始日算第 1 天。勾选侧栏展示后从侧栏也能编辑同一条记录；取消展示不删除日历。2 月 29 日只在闰年重复。本机日历保存在设备，联网日历保存在自己的后端。两者不会自动同步。")
    val daily = FeatureGuide("小组件", "碳硅圈与日记可手动记录，本机与联网各自保存。日历也支持本机记录；文件库、书房、语音等服务需要对应后端能力。宠物系统和未来小组件仍是预留入口。")
    val vault = FeatureGuide("文件库与拾潮", "基本文件库归集聊天中真实的媒体文件，不收录普通聊天文字。拾潮保存主动珍藏的文字段落、媒体等，可添加备注；删除珍藏不等同于删除原聊天。需要联网后端，本机媒体库尚未接入。")
    val library = FeatureGuide("潮中书房", "在书房导入受支持的电子书，阅读章节并使用书签、批注等现有入口。书籍、批注和进度由自己的联网后端保存；本机书房尚未接入。")
    val backup = FeatureGuide("聊天记录与导出", "屋主设置中的聊天记录提供导入/导出入口。联网模式按实际导出范围保留后端资料；本机 JSON/HTML 只是阶段性快照，目前包含聊天、日记动态、模型配置和日历，不是完整可恢复备份，不包含 Key 或 OAuth 凭据。切换工作区不等于同步，卸载应用前不要假定资料可以恢复。")
    val settings = FeatureGuide("屋主设置", "这里管理外观、显示资料、模型箱、聊天记录、基础设置、诊断与版本。外观资料不等同于模型长期记忆。本机模式和联网模式各有存储边界，账户页可以返回开屏切换模式。参观入口只用于浏览，不能当作真正的后台登录。")
    val tools = FeatureGuide("模型工作台 / MCP 工具", "工具工作台与 MCP 对话区不是一回事。工具调用依赖已配置的后端、权限与模型支持，工具记录可用于查看实际执行。外部 MCP 客户端须连接自己部署的服务并获得授权；本机模式不支持海岸工具执行。")
}

@Composable
internal fun FeatureGuideButton(guide: FeatureGuide) {
    var open by remember(guide) { mutableStateOf(false) }
    IconButton(onClick = { open = true }, modifier = Modifier.size(30.dp)) {
        Text("?", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall)
    }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        title = { Text(guide.title) },
        text = { Text(guide.body, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = { TextButton(onClick = { open = false }) { Text("知道了") } }
    )
}
