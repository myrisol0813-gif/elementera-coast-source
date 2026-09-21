package com.elementeracoast.app.feature.wolf

import com.elementeracoast.app.core.model.modelDisplayName

enum class ModelSeries(val title: String) {
    O("o 系列"),
    Gpt4("GPT-4 系列"),
    Gpt5("GPT-5 系列"),
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
