package com.elementeracoast.app.core.local

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

@Serializable
data class ArchiveV2Object(
    val size: Long,
    val chunks: List<String>,
    @SerialName("object_sha256") val objectSha256: String
)

/** Shared V2 object contract. Output must be temporary staging, not live data. */
object ArchiveV2Chunks {
    const val CHUNK_BYTES = 1024 * 1024
    private val hex = Regex("[0-9a-f]{64}")
    fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun fingerprint(size: Long, chunks: List<String>): String =
        digest(("coast-object-v2\n"+size+"\n"+chunks.joinToString("\n")).encodeToByteArray())
    fun validate(value: ArchiveV2Object, maxBytes: Long = 9007199254740991L, maxChunks: Int = 65536): ArchiveV2Object {
        require(value.size in 0..maxBytes && value.size <= 9007199254740991L)
        val count = value.size / CHUNK_BYTES + if(value.size % CHUNK_BYTES == 0L) 0 else 1
        require(value.chunks.size <= maxChunks && value.chunks.size.toLong() == count)
        require(value.chunks.all(hex::matches) && hex.matches(value.objectSha256))
        require(fingerprint(value.size,value.chunks)==value.objectSha256) { "object manifest digest mismatch" }
        return value
    }
    fun path(value: ArchiveV2Object): String {
        require(hex.matches(value.objectSha256));return "objects/"+value.objectSha256
    }
    /** Validate every chunk before writing, reject truncation and extra bytes. */
    fun stage(value: ArchiveV2Object,input: InputStream, output: OutputStream,maxBytes: Long = 9007199254740991L,maxChunks: Int = 65536) {
        validate(value,maxBytes,maxChunks)
        var size=0L
        for((index,hash) in value.chunks.withIndex()) {
            val bytes=ByteArray(minOf(CHUNK_BYTES.toLong(),value.size-size).toInt())
            var offset=0
            while(offset<bytes.size) {
                val n=input.read(bytes,offset,bytes.size-offset)
                require(n>0) { "archive object incomplete" };offset+=n
            }
            require(digest(bytes)==hash) { "archive chunk verification failed at "+index }
            output.write(bytes);size+=bytes.size
        }
        require(size==value.size && input.read()==-1) { "archive object length mismatch" }
    }
}
