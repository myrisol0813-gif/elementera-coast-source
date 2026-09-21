package com.elementeracoast.app.feature.letters

internal fun defaultIslandLetter(modelName: String): String = """
To $modelName：

这是 source 版本的公开占位入住信。这里不包含生产环境中的私人关系文本、真实记忆或私人提示词。你可以在自托管环境中按自己的需要编辑这封信。
""".trimIndent()
