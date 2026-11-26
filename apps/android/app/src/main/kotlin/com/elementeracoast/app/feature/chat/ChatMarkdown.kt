package com.elementeracoast.app.feature.chat

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp
import java.net.URI

// Render the common chat Markdown subset without HTML or external image loading.
// Raw message text remains the source for copying, history, and archives.
private val heading=Regex("""^(#{1,6})[ \t]+(.*)$""")
private val bullet=Regex("""^([ \t]*)[-*+][ \t]+(.*)$""")
private val inline=Regex("""`([^`\n]+)`|\[([^\]\n]+)\]\((https?://[^\s()]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*""",RegexOption.IGNORE_CASE)
private fun safeChatUrl(raw:String):String?=runCatching{
    val uri=URI(raw)
    if(uri.scheme.lowercase() in setOf("http","https")&&!uri.host.isNullOrBlank()&&uri.userInfo==null)raw else null
}.getOrNull()

internal fun renderChatMarkdown(raw:String):AnnotatedString {
    val b=AnnotatedString.Builder()
    fun styled(text:String,style:SpanStyle){
        val start=b.length;b.append(text);if(b.length>start)b.addStyle(style,start,b.length)
    }
    fun inlineText(text:String,depth:Int=0){
        if(depth>3){b.append(text);return}
        var cursor=0
        for(m in inline.findAll(text)){
            b.append(text.substring(cursor,m.range.first))
            val start=b.length
            when {
                m.groups[1]!=null -> styled(m.groupValues[1],SpanStyle(fontFamily=FontFamily.Monospace))
                m.groups[2]!=null -> {
                    val url=safeChatUrl(m.groupValues[3])
                    if(url==null)b.append(m.value) else {
                        b.append(m.groupValues[2])
                        b.addLink(LinkAnnotation.Url(url,TextLinkStyles(style=SpanStyle(textDecoration=TextDecoration.Underline))),start,b.length)
                    }
                }
                m.groups[4]!=null||m.groups[5]!=null -> {
                    inlineText(m.groupValues[4].ifEmpty{m.groupValues[5]},depth+1)
                    b.addStyle(SpanStyle(fontWeight=FontWeight.Bold),start,b.length)
                }
                else -> styled(m.groupValues[6],SpanStyle(fontStyle=FontStyle.Italic))
            }
            cursor=m.range.last+1
        }
        b.append(text.substring(cursor))
    }
    var fence=false
    raw.split('\n').forEachIndexed { i,line ->
        if(i>0)b.append("\n")
        val trimmed=line.trimStart()
        if(trimmed.startsWith("```")){
            fence=!fence
            return@forEachIndexed
        }
        if(fence){styled(line,SpanStyle(fontFamily=FontFamily.Monospace));return@forEachIndexed}
        val h=heading.matchEntire(line)
        val li=bullet.matchEntire(line)
        when {
            h!=null -> {
                val start=b.length
                inlineText(h.groupValues[2])
                b.addStyle(SpanStyle(fontWeight=FontWeight.Bold,fontSize=(if(h.groupValues[1].length==1)19 else 17).sp),start,b.length)
            }
            li!=null -> {b.append(li.groupValues[1]+"• ");inlineText(li.groupValues[2])}
            else -> inlineText(line)
        }
    }
    return b.toAnnotatedString()
}
