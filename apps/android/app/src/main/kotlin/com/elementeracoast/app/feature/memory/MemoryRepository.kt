package com.elementeracoast.app.feature.memory

import com.elementeracoast.app.core.remote.RemoteCacheStore
import com.elementeracoast.app.core.remote.RemoteCustomInstructions
import com.elementeracoast.app.core.remote.RemoteMemoryEntry
import com.elementeracoast.app.core.remote.RemoteMemoryEntryWriteRequest
import com.elementeracoast.app.core.remote.RemoteMemoryPocket
import com.elementeracoast.app.core.remote.RemoteMemoryPocketResolveRequest
import com.elementeracoast.app.core.remote.RemoteGlobalExcerpt
import com.elementeracoast.app.core.remote.RemoteGlobalExcerptCandidate
import com.elementeracoast.app.core.remote.RemoteGlobalExcerptRevision
import com.elementeracoast.app.core.remote.RemoteGlobalExcerptResponse
import com.elementeracoast.app.core.remote.RemoteWorldbookEntry
import com.elementeracoast.app.core.remote.RemoteWorldbookEntryWriteRequest
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface MemoryRepository {
    val snapshot: StateFlow<MemorySnapshot>
    fun cachedSnapshot(): MemorySnapshot
    suspend fun refresh(conversationId: String)
    suspend fun refreshEntries()
    suspend fun refreshPockets(conversationId: String)
    suspend fun refreshWorldbook()
    suspend fun refreshInstructions()
    suspend fun refreshGlobalExcerpt()
    suspend fun setGlobalExcerptWriteEnabled(enabled: Boolean)
    suspend fun confirmGlobalExcerptCandidate(id: String, editedBody: String? = null)
    suspend fun discardGlobalExcerptCandidate(id: String)
    suspend fun saveEntry(entry: MemoryEntry): MemoryEntry
    suspend fun deleteEntry(id: String)
    suspend fun resolvePocket(id: String, action: String, tag: String? = null)
    suspend fun saveWorldbook(entry: WorldbookEntry): WorldbookEntry
    suspend fun deleteWorldbook(id: String)
    suspend fun testWorldbook(input: String): List<WorldbookEntry>
    suspend fun saveInstructions(content: String): CustomInstructions
}

class DefaultMemoryRepository(
    private val remote: MemoryRemoteDataSource,
    private val cache: RemoteCacheStore
) : MemoryRepository {
    private val initial = MemorySnapshot(
        memories = cache.memoryEntries("memory").map(::toEntry),
        seeds = cache.memoryEntries("seed").map(::toEntry),
        worldbook = cache.worldbookEntries().map(::toWorldbook),
        customInstructions = cache.customInstructions()?.let(::toInstructions) ?: CustomInstructions()
    )
    private val mutableSnapshot = MutableStateFlow(initial)
    override val snapshot: StateFlow<MemorySnapshot> = mutableSnapshot.asStateFlow()

    override fun cachedSnapshot(): MemorySnapshot = mutableSnapshot.value

    override suspend fun refresh(conversationId: String) = coroutineScope {
        val cleanConversationId = conversationId.trim()
        primePocketSnapshot(cleanConversationId)

        val memories = async { remote.listEntries("memory") }
        val seeds = async { remote.listEntries("seed") }
        val pockets = cleanConversationId.takeIf(String::isNotBlank)?.let { id ->
            async { remote.listPockets(id) }
        }
        val worldbook = async { remote.listWorldbook() }
        val instructions = async { remote.getInstructions() }
        val globalExcerpt = async { remote.getGlobalExcerpt() }

        val remoteMemories = memories.await()
        val remoteSeeds = seeds.await()
        val remotePockets = pockets?.await().orEmpty()
        val remoteWorldbook = worldbook.await()
        val remoteInstructions = instructions.await()
        val remoteGlobalExcerpt = globalExcerpt.await()

        cache.putMemoryEntries("memory", remoteMemories)
        cache.putMemoryEntries("seed", remoteSeeds)
        if (cleanConversationId.isNotBlank()) cache.putMemoryPockets(cleanConversationId, remotePockets)
        cache.putWorldbookEntries(remoteWorldbook)
        cache.putCustomInstructions(remoteInstructions)

        mutableSnapshot.value = MemorySnapshot(
            memories = remoteMemories.map(::toEntry),
            seeds = remoteSeeds.map(::toEntry),
            pockets = remotePockets.map(::toPocket),
            pocketConversationId = cleanConversationId.ifBlank { null },
            worldbook = remoteWorldbook.map(::toWorldbook),
            customInstructions = remoteInstructions?.let(::toInstructions) ?: CustomInstructions(),
            globalExcerpt = toGlobalExcerpt(remoteGlobalExcerpt)
        )
    }

    override suspend fun refreshEntries() {
        val memories = remote.listEntries("memory")
        val seeds = remote.listEntries("seed")
        cache.putMemoryEntries("memory", memories)
        cache.putMemoryEntries("seed", seeds)
        mutableSnapshot.value = mutableSnapshot.value.copy(
            memories = memories.map(::toEntry),
            seeds = seeds.map(::toEntry)
        )
    }

    override suspend fun refreshPockets(conversationId: String) {
        val cleanConversationId = conversationId.trim()
        if (cleanConversationId.isBlank()) {
            mutableSnapshot.value = mutableSnapshot.value.copy(pockets = emptyList(), pocketConversationId = null)
            return
        }
        primePocketSnapshot(cleanConversationId)
        val pockets = remote.listPockets(cleanConversationId)
        cache.putMemoryPockets(cleanConversationId, pockets)
        mutableSnapshot.value = mutableSnapshot.value.copy(
            pockets = pockets.map(::toPocket),
            pocketConversationId = cleanConversationId
        )
    }

    override suspend fun refreshWorldbook() {
        val entries = remote.listWorldbook()
        cache.putWorldbookEntries(entries)
        mutableSnapshot.value = mutableSnapshot.value.copy(worldbook = entries.map(::toWorldbook))
    }

    override suspend fun refreshInstructions() {
        val instructions = remote.getInstructions()
        cache.putCustomInstructions(instructions)
        mutableSnapshot.value = mutableSnapshot.value.copy(
            customInstructions = instructions?.let(::toInstructions) ?: CustomInstructions()
        )
    }

    override suspend fun refreshGlobalExcerpt() {
        val response = remote.getGlobalExcerpt()
        mutableSnapshot.value = mutableSnapshot.value.copy(globalExcerpt = toGlobalExcerpt(response))
    }

    override suspend fun setGlobalExcerptWriteEnabled(enabled: Boolean) {
        remote.setGlobalExcerptWriteEnabled(enabled)
        refreshGlobalExcerpt()
    }

    override suspend fun confirmGlobalExcerptCandidate(id: String, editedBody: String?) {
        remote.confirmGlobalExcerptCandidate(id, editedBody)
        refreshGlobalExcerpt()
    }

    override suspend fun discardGlobalExcerptCandidate(id: String) {
        remote.discardGlobalExcerptCandidate(id)
        refreshGlobalExcerpt()
    }

    override suspend fun saveEntry(entry: MemoryEntry): MemoryEntry {
        val tag = entry.tag.ifBlank { entry.tags.firstOrNull { it in canonicalMemoryTags }.orEmpty() }
        val request = RemoteMemoryEntryWriteRequest(
            entryType = entry.entryType,
            title = entry.title.trim(),
            lifeCore = entry.lifeCore.trim(),
            content = entry.content.trim(),
            usageHint = entry.usageHint.trim(),
            avoidHint = entry.avoidHint.trim(),
            memoryLevel = if (entry.entryType == "memory") entry.memoryLevel else "ordinary",
            status = entry.status,
            tag = tag,
            memoryTags = if (tag.isBlank()) emptyList() else listOf(tag),
            sourceModel = entry.sourceModel.trim(),
            sourceWindow = entry.sourceWindow.trim(),
            sourceTime = entry.sourceDate.takeIf(String::isNotBlank)
        )
        val saved = if (entry.id.isBlank()) remote.createEntry(request) else remote.patchEntry(entry.id, request)
        refreshEntries()
        return toEntry(saved)
    }

    override suspend fun deleteEntry(id: String) {
        remote.deleteEntry(id)
        refreshEntries()
    }

    override suspend fun resolvePocket(id: String, action: String, tag: String?) {
        remote.resolvePocket(
            id,
            RemoteMemoryPocketResolveRequest(action = action, tag = if (action == "discard") null else tag)
        )
        val conversationId = mutableSnapshot.value.pocketConversationId
        if (!conversationId.isNullOrBlank()) refreshPockets(conversationId)
        if (action != "discard") refreshEntries()
    }

    override suspend fun saveWorldbook(entry: WorldbookEntry): WorldbookEntry {
        val request = RemoteWorldbookEntryWriteRequest(
            title = entry.title.trim(),
            content = entry.content.trim(),
            keywords = entry.keywords.map(String::trim).filter(String::isNotBlank).distinct(),
            useRegex = entry.useRegex,
            caseSensitive = entry.caseSensitive,
            constantActive = entry.constantActive,
            priority = entry.priority,
            scanDepth = entry.scanDepth,
            enabled = entry.enabled,
            scope = entry.scope,
            visitorSafe = entry.visitorSafe
        )
        val saved = if (entry.id.isBlank()) remote.createWorldbook(request) else remote.patchWorldbook(entry.id, request)
        refreshWorldbook()
        return toWorldbook(saved)
    }

    override suspend fun deleteWorldbook(id: String) {
        remote.deleteWorldbook(id)
        refreshWorldbook()
    }

    override suspend fun testWorldbook(input: String): List<WorldbookEntry> = remote.testWorldbook(input).map(::toWorldbook)

    override suspend fun saveInstructions(content: String): CustomInstructions {
        val saved = remote.putInstructions(content)
        cache.putCustomInstructions(saved)
        val mapped = saved?.let(::toInstructions) ?: CustomInstructions()
        mutableSnapshot.value = mutableSnapshot.value.copy(customInstructions = mapped)
        return mapped
    }

    private fun primePocketSnapshot(conversationId: String) {
        if (conversationId.isBlank()) {
            mutableSnapshot.value = mutableSnapshot.value.copy(pockets = emptyList(), pocketConversationId = null)
            return
        }
        mutableSnapshot.value = mutableSnapshot.value.copy(
            pockets = cache.memoryPockets(conversationId).map(::toPocket),
            pocketConversationId = conversationId
        )
    }

    private companion object {
        fun toEntry(value: RemoteMemoryEntry) = MemoryEntry(
            id = value.id,
            entryType = value.entryType,
            title = value.title,
            lifeCore = value.lifeCore,
            content = value.content,
            usageHint = value.usageHint,
            avoidHint = value.avoidHint,
            memoryLevel = value.memoryLevel,
            status = value.status,
            tags = value.memoryTags,
            sourceModel = value.sourceModel,
            sourceWindow = value.sourceWindow,
            sourceDate = value.sourceDate,
            tag = value.tag
        )

        fun toPocket(value: RemoteMemoryPocket) = MemoryPocket(
            id = value.id,
            conversationId = value.conversationId,
            title = value.title,
            lifeCore = value.lifeCore,
            content = value.content,
            usageHint = value.usageHint,
            avoidHint = value.avoidHint,
            sourceExcerpt = value.sourceExcerpt,
            status = value.status
        )

        fun toWorldbook(value: RemoteWorldbookEntry) = WorldbookEntry(
            id = value.id,
            title = value.title,
            content = value.content,
            keywords = value.keywords,
            useRegex = value.useRegex,
            caseSensitive = value.caseSensitive,
            constantActive = value.constantActive,
            priority = value.priority,
            scanDepth = value.scanDepth,
            enabled = value.enabled,
            scope = value.scope,
            visitorSafe = value.visitorSafe
        )

        fun toGlobalExcerpt(response: RemoteGlobalExcerptResponse) = GlobalExcerpt(
            writeGuidance = response.excerpt.writeGuidance,
            body = response.excerpt.body,
            writeEnabled = response.excerpt.writeEnabled,
            revision = response.excerpt.revision,
            createdAt = response.excerpt.createdAt,
            updatedAt = response.excerpt.updatedAt,
            candidates = response.candidates.map(::toGlobalExcerptCandidate),
            revisions = response.revisions.map(::toGlobalExcerptRevision)
        )

        fun toGlobalExcerptCandidate(value: RemoteGlobalExcerptCandidate) = GlobalExcerptCandidate(
            id = value.id,
            proposedBody = value.proposedBody,
            changeKind = value.changeKind,
            reason = value.reason,
            sourceConversationId = value.sourceConversationId,
            sourceMessageId = value.sourceMessageId,
            sourceModel = value.sourceModel,
            createdAt = value.createdAt
        )

        fun toGlobalExcerptRevision(value: RemoteGlobalExcerptRevision) = GlobalExcerptRevision(
            id = value.id,
            revision = value.revision,
            beforeBody = value.beforeBody,
            afterBody = value.afterBody,
            sourceConversationId = value.sourceConversationId,
            sourceMessageId = value.sourceMessageId,
            modelReason = value.modelReason,
            confirmationMode = value.confirmationMode,
            operator = value.operator,
            createdAt = value.createdAt
        )

        fun toInstructions(value: RemoteCustomInstructions) = CustomInstructions(
            content = value.content,
            status = value.status,
            updatedAt = value.updatedAt,
            updatedBy = value.updatedBy,
            source = value.source
        )
    }
}
