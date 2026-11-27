package com.elementeracoast.app.core.local

/** A wake never implicitly gains all regular tools, nor the permissions of
 * a previous chat turn. The ordinary local read/write switches still apply. */
internal object LocalDreamToolPolicy{
    fun allowed(c:LocalDreamLedger.Claim,name:String):Boolean{
        val e=c.config.execution?:return false
        return when(name){
            "dream_read_history"->e.readHistory
            "dream_write_note"->e.writeNote
            "dream_schedule_extra"->c.config.allowExtra&&e.extraPerDay>0
            "independent_web_search","independent_web_read"->e.allowWeb
            "library_books","library_read","library_notes"->e.allowLibrary
            "memory_search"->e.allowMemory
            "calendar_list"->e.allowCalendar
            "vault_search","vault_read"->e.allowCollection
            "library_write"->e.allowLibraryWrite
            "create_moment","create_diary"->e.allowDailyWrite
            "calendar_create"->e.allowCalendarWrite
            "voice_create"->e.allowVoice&&e.voiceLimit>0
            "image_generate"->e.allowImage&&e.imageLimit>0
            else->false
        }
    }
}
