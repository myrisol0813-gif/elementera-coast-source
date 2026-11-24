package com.elementeracoast.app.core.local

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
data class ArchiveV2Coverage(val module: String, val coverage: String, val count: Int)
@Serializable
data class ArchiveV2Record(
    val module: String, val id: String,
    @SerialName("record_object") val recordObject: String,
    @SerialName("media_objects") val mediaObjects: List<String>,
    val dependencies: List<String>
)
@Serializable
data class ArchiveV2Manifest(
    val format: String, val version: Int, val workspace: String,
    @SerialName("application_id") val applicationId: String,
    @SerialName("exported_at") val exportedAt: String,
    val modules: List<ArchiveV2Coverage>, val records: List<ArchiveV2Record>, val objects: List<ArchiveV2Object>
)
data class ArchiveV2ManifestSummary(val bytes: Long, val records: Int, val objects: Int, val declaredComplete: Boolean)
object ArchiveV2Manifests {
    val modules = listOf("chat","attachments","dogtalk_records","dogtalk_snapshots","voice","memory_entries","memory_pockets","thinking_soil","thinking_soil_history","calendar","daily","model_profile","user_portrait","self_portrait","worldbook","custom_instructions","vault","library","appearance","tools")
    private val id = Regex("[A-Za-z0-9_.:-]{1,200}")
    fun validate(m: ArchiveV2Manifest,maxBytes: Long=3L*1024*1024*1024,maxObjects: Int=8192,maxRecords: Int=100000): ArchiveV2ManifestSummary {
        require(m.format=="elementera-coast-archive" && m.version==2 && m.workspace in setOf("local","backend") &&
            m.applicationId in setOf("com.elementeracoast.app","com.elementeracoast.source"))
        require(runCatching { java.time.Instant.parse(m.exportedAt) }.isSuccess)
        require(m.modules.size==modules.size && m.modules.map { it.module }.toSet()==modules.toSet())
        require(m.modules.all { it.coverage in setOf("complete","partial","unavailable") && it.count>=0 })
        require(m.objects.size<=maxObjects && m.records.size<=maxRecords)
        val objects=m.objects.associateBy { it.objectSha256 };require(objects.size==m.objects.size)
        var bytes=0L
        m.objects.forEach { ArchiveV2Chunks.validate(it,maxBytes);require(it.size<=maxBytes-bytes);bytes+=it.size }
        val records=m.records.associateBy { it.module+"/"+it.id };require(records.size==m.records.size)
        val used=mutableSetOf<String>()
        val counts=m.records.groupingBy { it.module }.eachCount()
        for(r in m.records) {
            require(r.module in modules && id.matches(r.id) && r.recordObject in objects &&
                r.mediaObjects.distinct().size==r.mediaObjects.size && r.mediaObjects.all { it in objects })
            require(r.dependencies.distinct().size==r.dependencies.size && r.dependencies.all { it.length<=250 && it!=r.module+"/"+r.id && it in records })
            used.add(r.recordObject);used.addAll(r.mediaObjects)
        }
        require(used.size==objects.size)
        require(m.modules.all { it.count==(counts[it.module]?:0) && (it.coverage!="unavailable"||it.count==0) })
        return ArchiveV2ManifestSummary(bytes,records.size,objects.size,m.modules.all { it.coverage=="complete" })
    }
}
