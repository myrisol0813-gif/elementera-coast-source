package com.elementeracoast.app.core.restbox

import android.content.Context
import com.elementeracoast.app.core.local.LocalRestoreCount
import kotlinx.serialization.json.*

/** The studio is device-local in both workspaces. Keep it in the device envelope,
 * never in chat or cloud records, and restore it only as a separate selection. */
internal class NativeStudioArchiveV2(private val context:Context) {
    private val repo=RestArtRepository(context.assets)
    private val policy=NativeStudioPolicy(NativeSceneCatalogue.load(repo),repo.appearance())
    private val store=NativeStudioStore(context)
    fun capture():JsonObject? {
        val loaded=store.load(policy)
        require(loaded.warning==null){"造物间旧资料未恢复，无法生成包含它的完整归档。请先在造物间处理旧存档。"}
        return loaded.raw?.let { verified(Json.parseToJsonElement(it).jsonObject) }
    }
    fun verified(value:JsonObject):JsonObject {
        require(value.keys==setOf("version","layout","household","room","pets","reducedMotion","poseChoices"))
        val raw=value.toString()
        require(raw.toByteArray(Charsets.UTF_8).size<=1_000_000)
        return Json.parseToJsonElement(policy.encode(policy.decode(raw))).jsonObject
    }
    fun restore(value:JsonObject,confirm:Boolean):LocalRestoreCount {
        val next=verified(value).toString()
        // Preview is read-only: do not run automatic old WebView migration here.
        val old=store.raw()
        val same=old?.let{runCatching{policy.encode(policy.decode(it))==next}.getOrDefault(false)}==true
        if(same)return LocalRestoreCount(0,1,0)
        if(confirm)store.replaceFromArchive(next)
        return LocalRestoreCount(1,0,if(old!=null)1 else 0)
    }
}
