package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.remote.*
import java.time.LocalDateTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.*

/** Only the saved window's explicitly enabled fields may enter the model context. */
internal fun localReality(
    store: LocalPersistence, settings: ConversationContextSettings,
    snapshot: RemoteRealityContext, now: LocalDateTime = LocalDateTime.now()
): RemoteDeskRealityContext {
    val clean=settings.normalized()
    if(!clean.realityEnabled)return RemoteDeskRealityContext()
    val items=mutableListOf<RemoteDeskRealityItem>();val missing=mutableListOf<String>()
    fun add(key:String,label:String,value:()->String) {
        if(!clean.has(key))return
        val v=value().trim()
        if(v.isBlank())missing.add(label)else items.add(RemoteDeskRealityItem(key,label,v))
    }
    fun clip(v:String,max:Int=120)=v.replace(Regex("[\\r\\n\\t]+")," ").trim().take(max)
    add("date","日期"){now.toLocalDate().toString()}
    add("time","时间"){listOf(now.format(DateTimeFormatter.ofPattern("HH:mm")),clip(snapshot.timezone,80)).filter{it.isNotBlank()}.joinToString(" · ")}
    add("battery","电量"){snapshot.battery?.let{b->if(b.percent in 0..100) listOfNotNull("${b.percent}%",b.charging?.let{if(it)"正在充电" else "未充电"}).joinToString(" · ") else ""}.orEmpty()}
    add("weather","天气"){snapshot.weather?.let{listOf(clip(it.city,80),clip(it.summary,220)).filter{v->v.isNotBlank()}.joinToString(" · ")}.orEmpty()}
    add("location","位置"){clip(snapshot.location?.label.orEmpty())}
    add("recent_app","最近使用 App"){clip(snapshot.recentApp?.name.orEmpty())}
    add("app_usage","今日 App 使用时间"){snapshot.appUsage.filter{it.name.isNotBlank()&&it.minutes in 0..1440}.take(5).joinToString(" · "){clip(it.name,100)+" "+it.minutes+" 分钟"}}
    add("steps","步数"){snapshot.steps?.takeIf{it.count in 0..200000}?.let{listOf(clip(it.basis,80),it.count.toString()+" 步").filter{v->v.isNotBlank()}.joinToString(" · ")}.orEmpty()}
    add("calendar","海岸日历未来 7 天"){
        val start=now.toLocalDate();val end=start.plusDays(6)
        val months=listOf(YearMonth.from(start),YearMonth.from(end)).distinct()
        val events=months.flatMap{LocalCalendarStore(store).list(it.toString())}.filter{r->
            val day=r["occurrence_day"]?.jsonPrimitive?.contentOrNull.orEmpty()
            r["kind"]?.jsonPrimitive?.contentOrNull=="event"&&day>=start.toString()&&day<=end.toString()
        }
        if(events.isEmpty())"未来 7 天无重要日期"else events.joinToString("\n"){r->r.getValue("occurrence_day").jsonPrimitive.content+"｜"+clip(r.getValue("title").jsonPrimitive.content)}
    }
    val text=items.joinToString("\n"){it.label+"："+it.text}
    return RemoteDeskRealityContext(status=if(items.isEmpty())"已开启 · 无数据"else "已递给",
        enabled=true,selected=clean.realityFields,delivered=items.isNotEmpty(),deliveredItems=items,missing=missing,context=text)
}
internal fun localResponseMode(settings:ConversationContextSettings):RemoteDeskResponseMode {
    if(!settings.shortReplyMode)return RemoteDeskResponseMode()
    val text="当前对话开启了短句模式。优先自然、简短地接话；若用户的问题需要解释或自然进入深入讨论，不必为了短而截断内容。"
    return RemoteDeskResponseMode(status="短句模式",shortReplyMode=true,delivered=true,context=text)
}
