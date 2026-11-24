package com.elementeracoast.app.core.local

import java.io.File
import java.util.zip.ZipFile
import kotlinx.serialization.json.Json

/** Read a V2 ZIP into private staging, without restoring or changing live data.
 * Caller owns the temporary ZIP file and staging session. */
object ArchiveV2ZipReader {
    private val json=Json { ignoreUnknownKeys=false }
    private const val MAX_MANIFEST=2*1024*1024
    fun stage(file: File,staging: ArchiveV2Stage,maxBytes: Long=3L*1024*1024*1024): ArchiveV2Manifest {
        require(file.isFile && file.length()<=maxBytes+16L*1024*1024)
        ZipFile(file).use { zip ->
            val entries=zip.entries().asSequence().toList()
            require(entries.size<=8193 && entries.map { it.name }.distinct().size==entries.size)
            require(entries.all { !it.isDirectory && (it.name=="manifest.json"||Regex("objects/[0-9a-f]{64}").matches(it.name)) })
            val meta=zip.getEntry("manifest.json")?:error("缺少归档清单。")
            require(meta.size in 1L..MAX_MANIFEST.toLong())
            val raw=zip.getInputStream(meta).use { input ->
                val bytes=ByteArray(meta.size.toInt());var offset=0
                while(offset<bytes.size){val n=input.read(bytes,offset,bytes.size-offset);require(n>0);offset+=n}
                require(input.read()==-1);bytes.decodeToString(throwOnInvalidSequence=true)
            }
            val manifest=json.decodeFromString(ArchiveV2Manifest.serializer(),raw)
            ArchiveV2Manifests.validate(manifest,maxBytes)
            val expected=manifest.objects.associateBy { ArchiveV2Chunks.path(it) }
            require(entries.map { it.name }.toSet()==expected.keys+"manifest.json")
            for((path,descriptor) in expected){
                val entry=zip.getEntry(path)
                require(entry.size==descriptor.size && entry.compressedSize>=0)
                zip.getInputStream(entry).use { staging.stage(descriptor,it,maxBytes) }
            }
            // Staged files are available for verification and preview only.
            return manifest
        }
    }
}
