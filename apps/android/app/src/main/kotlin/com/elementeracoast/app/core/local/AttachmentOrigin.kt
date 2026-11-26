package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteHistory
import kotlinx.serialization.json.*

/** Resolve authorship using the persisted variant that actually references the
 * original. Never infer a sender from a filename or from the selected branch. */
internal data class AttachmentOrigin(val role:String?,val messageId:String?,val status:String)
internal fun attachmentOrigin(h:RemoteHistory?,row:JsonObject):AttachmentOrigin{
    fun s(k:String)=row[k]?.jsonPrimitive?.contentOrNull
    val tid=s("turn_id")?:return AttachmentOrigin(null,null,"unlinked")
    val turn=h?.turns?.firstOrNull{it.id==tid}?:return AttachmentOrigin(null,null,"missing")
    val refs=buildList{
        for((role,variants) in listOf("user" to turn.user.variants,"assistant" to turn.assistant.variantsByUserVariant.values.flatten())){
            for(v in variants)if(v.attachments.any{a->a.id==s("id")&&a.type==s("kind")&&a.name==s("name")&&a.mime==s("mime")&&a.size==row["size"]?.jsonPrimitive?.longOrNull})add(role to v.id)
        }
    }
    if(refs.map{it.first}.distinct().size!=1)return AttachmentOrigin(null,null,if(refs.isEmpty())"unlinked" else "ambiguous")
    val id=refs.map{it.second}.distinct().singleOrNull()
    return AttachmentOrigin(refs.first().first,id,if(id!=null)"linked" else "multiple_variants")
}
