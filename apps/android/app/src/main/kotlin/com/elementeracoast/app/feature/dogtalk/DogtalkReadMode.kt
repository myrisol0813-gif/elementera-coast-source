package com.elementeracoast.app.feature.dogtalk

enum class DogtalkReadMode(
    val wireValue: String,
    val label: String,
    val futureSemantics: String
) {
    KeepPrivate(
        wireValue = "keep_private",
        label = "不需要，放着就好",
        futureSemantics = "只放着，不给模型看。"
    ),
    WhenConfused(
        wireValue = "when_confused",
        label = "模型伙伴困惑时可以看一点",
        futureSemantics = "暂时 dormant，只表达未来许可；当前不会自动判断困惑，也不会提交给模型。"
    ),
    ReadNow(
        wireValue = "read_now",
        label = "这次希望模型伙伴直接读一下",
        futureSemantics = "只带入下一次发送一次，随后由后端降回不需要。"
    );

    companion object {
        fun fromWire(value: String): DogtalkReadMode = entries.firstOrNull { it.wireValue == value } ?: KeepPrivate
    }
}
