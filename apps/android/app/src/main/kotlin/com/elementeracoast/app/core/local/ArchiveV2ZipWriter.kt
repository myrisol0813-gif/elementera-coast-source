package com.elementeracoast.app.core.local

import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Sequential writer for the common V2 ZIP wire format. Caller provides an
 * abortable temporary destination and publishes only after successful close. */
class ArchiveV2ZipWriter(output: OutputStream) : AutoCloseable {
    private val zip=ZipOutputStream(output)
    private val objects=linkedMapOf<String,ArchiveV2Object>()
    private var state="open"
    private var bytes=0L
    fun objectEntry(descriptor: ArchiveV2Object, input: InputStream) {
        check(state=="open")
        ArchiveV2Chunks.validate(descriptor,maxBytes=3L*1024*1024*1024)
        val existing=objects[descriptor.objectSha256]
        if(existing!=null) {
            require(existing==descriptor)
            ArchiveV2Chunks.stage(descriptor,input,object:OutputStream(){override fun write(b:Int){};override fun write(b:ByteArray,off:Int,len:Int){} })
            return
        }
        require(objects.size<8192 && descriptor.size<=3L*1024*1024*1024-bytes)
        state="entry"
        try {
            zip.putNextEntry(ZipEntry(ArchiveV2Chunks.path(descriptor)))
            ArchiveV2Chunks.stage(descriptor,input,zip)
            zip.closeEntry()
            objects[descriptor.objectSha256]=descriptor
            bytes+=descriptor.size
            state="open"
        }catch(e:Exception){state="failed";throw e}
    }
    fun finish(manifest: ArchiveV2Manifest) {
        check(state=="open")
        ArchiveV2Manifests.validate(manifest)
        require(manifest.objects.associateBy { it.objectSha256 }==objects)
        state="closing"
        try {
            val data=Json.encodeToString(manifest).encodeToByteArray()
            zip.putNextEntry(ZipEntry("manifest.json"))
            zip.write(data);zip.closeEntry();zip.finish();zip.close()
            state="closed"
        }catch(e:Exception){state="failed";throw e}
    }
    override fun close(){if(state!="closed"){state="failed";zip.close()}}
}
