package com.elementeracoast.app.core.model

/** Visible non-chat surfaces aligned to the current PWA product shell. */
enum class FeatureDestination(val title: String, val subtitle: String) {
    Memory("轨迹 / 记忆", "记忆库、种子库、世界书与自定义指令"),
    Daily("小组件", "碳硅圈、日记与宠物系统"),
    Wolf("屋主设置 / 屋主设置", "显示资料、外观、聊天与运行设置"),
    ActionLog("模型工作台 / 模型工作台", "另一位屋主的工作台"),
    IslandLetter("登岛信", "当前窗口与当前模型独立保存")
}
