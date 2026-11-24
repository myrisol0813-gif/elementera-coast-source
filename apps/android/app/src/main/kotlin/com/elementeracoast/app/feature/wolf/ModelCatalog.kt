package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.model.modelDisplayName

enum class ModelSeries(val title: String) {
    O("o 系列"),
    Gpt4("GPT-4 系列"),
    Gpt5("GPT-5 系列"),
    Gpt6("GPT-6 系列"),
    OtherOpenAi("其他 OpenAI Chat"),
    Free("Free Test"),
    Image("图片模型")
}

data class LocalModelCatalogItem(
    val id: String,
    val displayName: String = modelDisplayName(id),
    val series: ModelSeries = classifyModelSeries(id)
)

internal fun classifyModelSeries(modelId: String): ModelSeries {
    val id = modelId.trim().lowercase()
    return when {
        id.contains(":free") || id.startsWith("free:") || id.contains(" free") -> ModelSeries.Free
        id.contains("gpt-image") || id.contains("dall-e") || id.contains("image-") -> ModelSeries.Image
        Regex("(^|/)o[0-9]").containsMatchIn(id) || Regex("^o[0-9]").containsMatchIn(id) -> ModelSeries.O
        id.contains("gpt-4") -> ModelSeries.Gpt4
        id.contains("gpt-5") -> ModelSeries.Gpt5
        id.contains("gpt-6") -> ModelSeries.Gpt6
        else -> ModelSeries.OtherOpenAi
    }
}

internal fun groupedUnselectedModels(models: List<String>, current: String): Map<ModelSeries, List<LocalModelCatalogItem>> {
    val items = models
        .asSequence()
        .filter { it != current }
        .distinct()
        .map(::LocalModelCatalogItem)
        .toList()
    return ModelSeries.entries.associateWith { series -> items.filter { it.series == series } }
}

internal fun localProviderId(id: String): String = id.removePrefix("local:").substringBefore('/')
internal fun localRawModelId(id: String): String = if (id.startsWith("local:")) id.substringAfter('/') else id.removePrefix("chatgpt-plan:")

internal fun groupedLocalModels(models: List<String>, query: String, names: Map<String, String>): Map<ModelSeries, List<LocalModelCatalogItem>> {
    val needle = query.trim()
    val entries = models.asSequence().filter { (it.startsWith("local:") && '/' in it) || it.startsWith("chatgpt-plan:") }.distinct()
        .map { id -> LocalModelCatalogItem(id, modelDisplayName(localRawModelId(id)), classifyModelSeries(localRawModelId(id))) }
        .filter { item -> localRawModelId(item.id).contains(needle, ignoreCase = true) ||
            item.displayName.contains(needle, ignoreCase = true) ||
            (if (item.id.startsWith("chatgpt-plan:")) "ChatGPT 套餐 Codex" else names[localProviderId(item.id)].orEmpty()).contains(needle, ignoreCase = true) }
        .sortedBy { it.displayName.lowercase() }.toList()
    return ModelSeries.entries.associateWith { series -> entries.filter { it.series == series } }
}

internal enum class LocalModelChannel { Codex, Provider }

/** Browsing a channel never changes the active model. Keep provider IDs intact. */
internal fun localChannelModels(models: List<String>, channel: LocalModelChannel, connected: Boolean): List<String> = models.filter { id ->
    when (channel) {
        LocalModelChannel.Codex -> connected && id.startsWith("chatgpt-plan:") && id.removePrefix("chatgpt-plan:").isNotBlank()
        LocalModelChannel.Provider -> id.startsWith("local:") && '/' in id
    }
}.distinct()
