package com.elementeracoast.app.core.local

import java.io.File
import java.io.InputStream
import java.io.OutputStream

/**
 * Durable private-file staging for V2. A verified object is never automatically
 * linked to live messages; publication and record validation are separate.
 * The caller supplies an app-private staging root and available-space budget.
 */
class ArchiveV2Stage(root: File, sessionId: String) {
    private val hex = Regex("[0-9a-f]{64}")
    private val session: File
    private val objects: File
    init {
        require(Regex("[a-zA-Z0-9_-]{1,80}").matches(sessionId))
        require(root.isDirectory || root.mkdirs())
        session = File(root,sessionId)
        require(session.isDirectory || session.mkdir())
        require(session.canonicalFile.parentFile == root.canonicalFile)
        objects = File(session,"objects")
        require(objects.isDirectory || objects.mkdir())
        require(objects.canonicalFile.parentFile == session.canonicalFile)
    }
    private fun target(value: ArchiveV2Object): File {
        require(hex.matches(value.objectSha256))
        val f = File(objects,value.objectSha256)
        require(f.canonicalFile.parentFile == objects.canonicalFile)
        return f
    }
    @Synchronized fun stage(value: ArchiveV2Object, input: InputStream, maxBytes: Long): File {
        ArchiveV2Chunks.validate(value,maxBytes=maxBytes)
        val dest=target(value)
        if(dest.exists()) {
            // Verify an existing staged object, and verify the incoming stream too.
            verify(value,maxBytes)
            ArchiveV2Chunks.stage(value,input,discard(),maxBytes)
            return dest
        }
        require(value.size <= objects.usableSpace) { "insufficient staging space" }
        val temp=File.createTempFile("part-", ".tmp",objects)
        try {
            temp.outputStream().use { out -> ArchiveV2Chunks.stage(value,input,out,maxBytes);out.fd.sync() }
            require(!dest.exists() && temp.renameTo(dest)) { "staging publish failed" }
            return dest
        } finally { if(temp.exists())temp.delete() }
    }
    @Synchronized fun verify(value: ArchiveV2Object,maxBytes: Long): File {
        val dest=target(value)
        require(dest.isFile && dest.length()==value.size) { "staged object missing or incomplete" }
        dest.inputStream().use { ArchiveV2Chunks.stage(value,it,discard(),maxBytes) }
        return dest
    }
    private fun discard()=object: OutputStream() {
        override fun write(b: Int) {}
        override fun write(b: ByteArray,off: Int,len: Int) {}
    }
}
