package com.elementeracoast.app.core.restbox

import android.content.Context
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID

/** Upgrade-only recovery. Never start WebView; never open or mutate its original DB.
 * Only the exact former studio storage key is requested from a bounded temporary copy.
 */
internal object LegacyStudioRecovery {
    private val allowed=Regex("^(CURRENT|MANIFEST-[0-9]+|[0-9]+[.](log|ldb|sst))$")
    private const val MAX_COPY=32L*1024*1024
    private const val MAX_VALUE=1_000_000
    private val available by lazy { runCatching{System.loadLibrary("coast_native_art")}.isSuccess }
    @JvmStatic private external fun readCopiedLevelDb(path:String):ByteArray?

    internal fun decode(raw:ByteArray):String {
        require(raw.isNotEmpty()&&raw.size<=2*MAX_VALUE+1)
        val charset=when(raw[0].toInt()){
            0->{require((raw.size-1)%2==0);Charsets.UTF_16LE}
            1->Charsets.ISO_8859_1
            else->error("Unknown old storage encoding")
        }
        val text=charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(raw,1,raw.size-1)).toString()
        require(text.toByteArray(Charsets.UTF_8).size<=MAX_VALUE)
        return text
    }
    private data class Stamp(val name:String,val bytes:Long,val modified:Long)
    private fun inventory(dir:File):List<Stamp> {
        val files=requireNotNull(dir.listFiles()).filter{allowed.matches(it.name)}
        require(files.size<=512&&files.any{it.name=="CURRENT"})
        val stamps=files.map{
            require(it.isFile&&it.canonicalFile.parentFile==dir.canonicalFile)
            Stamp(it.name,it.length(),it.lastModified())
        }.sortedBy{it.name}
        require(stamps.sumOf{it.bytes}<=MAX_COPY)
        return stamps
    }
    private fun copiedValue(context:Context,dir:File):String? {
        require(available){"Native legacy reader unavailable"}
        val copy=File(context.cacheDir,"rest-recovery-"+UUID.randomUUID())
        require(copy.mkdir())
        try {
            val stamps=inventory(dir)
            for(s in stamps) {
                val from=File(dir,s.name)
                val to=File(copy,s.name)
                from.inputStream().use{input->to.outputStream().use{out->
                    val buffer=ByteArray(8192);var total=0L
                    while(true){val n=input.read(buffer);if(n<0)break;total+=n;require(total<=s.bytes);out.write(buffer,0,n)}
                    require(total==s.bytes)
                }}
            }
            require(inventory(dir)==stamps){"Legacy storage changed during recovery"}
            val raw=readCopiedLevelDb(copy.absolutePath)?:error("Legacy storage cannot be read")
            return if(raw.isEmpty())null else decode(raw)
        }finally{copy.deleteRecursively()}
    }
    fun recover(context:Context):Result<String?> = runCatching {
        val root=File(context.applicationInfo.dataDir).canonicalFile
        val web=File(root,"app_webview")
        if(!web.exists())return@runCatching null
        require(web.canonicalFile.parentFile==root)
        val dirs=listOf(File(web,"Local Storage"),File(web,"Default/Local Storage"))
        val values=mutableListOf<String>()
        for(storage in dirs.filter{it.isDirectory}){
            require(storage.canonicalPath.startsWith(web.canonicalPath+File.separator))
            val db=File(storage,"leveldb")
            if(db.isDirectory){
                require(db.canonicalFile.parentFile==storage.canonicalFile)
                copiedValue(context,db)?.let{values.add(it)}
            }else if(storage.listFiles().orEmpty().any{it.isFile}){
                // A different browser storage schema may be present. Do not claim it is empty.
                error("Unrecognized legacy storage")
            }
        }
        require(values.distinct().size<=1){"Conflicting legacy studio records"}
        values.firstOrNull()
    }
}
