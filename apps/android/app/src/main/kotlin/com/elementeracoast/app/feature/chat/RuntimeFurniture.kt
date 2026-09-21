package com.elementeracoast.app.feature.chat

import com.elementeracoast.app.core.remote.RemoteDeskSlip
import com.elementeracoast.app.core.remote.RemoteFurnitureItem
import com.elementeracoast.app.core.remote.RemoteFurnitureRun
import java.net.URI

internal fun runtimeFurnitureRuns(deskSlip: RemoteDeskSlip?): List<RemoteFurnitureRun> {
    if (deskSlip == null) return emptyList()
    val output = mutableListOf<RemoteFurnitureRun>()
    val attachments = deskSlip.attachments
    if (attachments != null) {
        val images = attachments.delivered.filter { it.mode == "vision" }
        val files = attachments.delivered.filter { it.mode == "text" }
        if (images.isNotEmpty()) {
            output += RemoteFurnitureRun(
                id = "runtime:attachment-vision",
                toolKey = "attachment.vision",
                label = if (images.size == 1) "看了一张图片" else "看了 ${images.size} 张图片",
                count = images.size,
                items = images.take(5).map { RemoteFurnitureItem(title = it.name.ifBlank { it.id }, kind = "图片") },
                extraCount = (images.size - 5).coerceAtLeast(0)
            )
        }
        if (files.isNotEmpty()) {
            output += RemoteFurnitureRun(
                id = "runtime:attachment-read",
                toolKey = "attachment.read",
                label = if (files.size == 1) "读了一份文件" else "读了 ${files.size} 份文件",
                count = files.size,
                items = files.take(5).map { RemoteFurnitureItem(title = it.name.ifBlank { it.id }, kind = "文件") },
                extraCount = (files.size - 5).coerceAtLeast(0)
            )
        }
        if (attachments.notDelivered.isNotEmpty()) {
            val missed = attachments.notDelivered
            output += RemoteFurnitureRun(
                id = "runtime:attachment-not-delivered",
                toolKey = "attachment.delivery",
                label = if (missed.size == 1) "有一份附件没有递进去" else "有 ${missed.size} 份附件没有递进去",
                status = "error",
                count = missed.size,
                items = missed.take(5).map {
                    RemoteFurnitureItem(
                        title = it.name.ifBlank { it.id },
                        kind = it.reason.ifBlank { "未递送" }
                    )
                },
                extraCount = (missed.size - 5).coerceAtLeast(0),
                errorType = missed.firstOrNull()?.reason?.ifBlank { "attachment_not_delivered" }
            )
        }
    }

    val search = deskSlip.webSearch
    if (search?.used == true) {
        val sources = search.results
        output += RemoteFurnitureRun(
            id = "runtime:web-search",
            toolKey = "web.search",
            label = "搜索了公开网络",
            count = search.requests.coerceAtLeast(1),
            items = sources.take(5).map { result ->
                val host = result.url.searchHost()
                RemoteFurnitureItem(
                    title = result.title.ifBlank { host.ifBlank { "搜索来源" } },
                    kind = host.ifBlank { "来源" }
                )
            },
            extraCount = (sources.size - 5).coerceAtLeast(0)
        )
    }
    return output
}

internal fun mergeFurnitureRuns(
    existing: List<RemoteFurnitureRun>,
    deskSlip: RemoteDeskSlip?
): List<RemoteFurnitureRun> = (existing + runtimeFurnitureRuns(deskSlip))
    .distinctBy { it.id }
    .take(16)

private fun String.searchHost(): String = runCatching {
    URI(this).host.orEmpty().removePrefix("www.")
}.getOrDefault("")
