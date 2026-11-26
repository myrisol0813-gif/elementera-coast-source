package com.elementeracoast.app.core.local

import com.elementeracoast.app.core.remote.RemoteChatMessage

/** Deterministic owner context policy, matching the online source order and comfort trimming. */
internal object LocalContextPolicy {
    private const val base = """遵循本轮提供的上下文与屋主保存的自定义指令回应。工具调用必须如实；没有执行成功的动作不能说成已经完成。"""
    private val guides=mapOf(
        "current" to """【当前消息】
这是用户本轮刚刚提交的消息。
它是当前任务最直接的输入，应优先用于理解问题、目标和约束。""",
        "recent" to """【最近上下文】
这是当前会话最近几轮消息。
它用于保持主题、术语和任务连续性，避免重复询问已经给出的信息。""",
        "user_portrait" to """【用户画像】
这是由用户确认的长期画像，记录模型逐渐形成的稳定用户理解。
它整篇进入上下文，不按关键词拆散召回；自动整理关闭时仍照常读取正式正文。""",
        "global_excerpt" to """【自我画像】
这是由用户确认的长期自我画像，记录模型对自身语言、判断、边界与连续性的稳定认识。
它整篇进入上下文，不按关键词拆散召回；自动整理关闭时仍照常读取正式正文。""",
        "custom" to """【核心自定义】
这是用户为当前公开 demo assistant 保存的自定义指令。
它用于补充响应偏好、格式要求、任务约束与允许的工具行为。""",
        "soil" to """【整理当前对话的纸条】
这是当前窗口的滚动摘要与待确认笔记。
它用于压缩较早内容并保留仍然相关的任务线索；
候选内容只有在用户确认后才可进入种子库或记忆库。
它不是唯一上下文，也不应覆盖当前消息与最近上下文。""",
        "memory" to """【相关记忆】
这是与当前任务相关、且已确认可使用的长期记录。
只在确实有帮助时引用，并以当前消息为最高优先级。""",
        "worldbook" to """【世界书】
这是被当前主题触发的设定资料。
它用于补足世界观、角色、项目或专有名词的背景，帮助模型正确理解上下文。""",
        "dogtalk" to """【用户草稿】
这是用户可选提供的私有草稿，用于补充当前消息尚未完整表达的背景。
仅在本轮明确提供时使用，不应自动升级为长期记忆或稳定偏好。""",
        "cross_window" to """【跨窗口读取】
这是本轮从其他对话窗口读取的近期聊天记录。
仅用于补充当前任务上下文；是否引用其中内容，应由当前消息与任务相关性决定。""",
        "reality" to """【现实上下文】
这是当前窗口明确允许模型看见的现场现实信息。
只把这里实际出现的事实当作本轮现实坐标；没有出现的设备或生活信息不要猜。""",
        "response_mode" to """【回应节奏】
这是当前窗口明确选择的表达节奏。
它只调整回应方式，不改变事实、关系位置或工具权限。""",
        "workbench" to """【工作台 / 工具回执】
这是代码、文件、接口、真机、GitHub 等技术领域的话题与事实结果。
它用于提供可核对的客观状态，并约束回复不要把未完成的动作说成已经完成。""",
        "external" to """【外部入口消息】
这是从应用外部临时读入、且尚未归档成内部对话窗口的材料。
本轮如果没有外部材料，则显示“本轮没有递入外部材料”。"""
    )
    fun estimate(value:String):Int {
        var wide=0;var narrow=0;var i=0
        while(i<value.length){
            val c=value.codePointAt(i)
            if(c in 0x3400..0x9fff || c in 0xf900..0xfaff || c in 0x3040..0x30ff || c in 0xac00..0xd7af)wide++ else narrow++
            i+=Character.charCount(c)
        }
        return wide+(narrow+3)/4
    }
    private fun body(value:String)=value.trim().replaceFirst(Regex("^【[^】]+】\\s*(?:\\n|$)"),"").trim()
    private fun block(key:String,value:String):String=body(value).let{if(it.isEmpty())"" else guides.getValue(key)+"\n"+it}
    private fun items(key:String,values:List<String>):String=if(values.isEmpty())""else guides.getValue(key)+"\n"+values.joinToString("\n"){"- "+it.trim()}
    fun formatSoil(current:String,after:List<String>):String {
        val lines=mutableListOf<String>()
        if(current.isNotBlank())lines.add("当前："+current.trim().take(1800))
        val notes=after.map{it.trim().take(420)}.filter{it.isNotBlank()}.take(7)
        if(notes.isNotEmpty()){lines.add("余思：");lines.addAll(notes.map{"- "+it})}
        return if(lines.isEmpty())""else ("【思维壤】\n"+lines.joinToString("\n")).take(1800)
    }
    data class Result(val messages:List<RemoteChatMessage>,val visible:List<RemoteChatMessage>,val soil:String,val dogtalk:String,
        val memoryCount:Int,val worldbookCount:Int,val estimated:Int,val ceiling:Int,val trimmed:Int){
        val over:Boolean get()=estimated>ceiling
    }
    fun assemble(instructions:String,userPortrait:String,selfPortrait:String,soilText:String,memories:List<String>,worldbook:List<String>,
        dogtalkText:String,crossWindow:String,reality:String,responseMode:String,input:List<RemoteChatMessage>,budget:Int,imageCount:Int=0):Result {
        val recent=input.filter{it.role in setOf("user","assistant")&&it.content.isNotBlank()}.toMutableList()
        val memory=memories.toMutableList();val world=worldbook.toMutableList()
        var soil=soilText;var dog=dogtalkText;var trimmed=0
        val ceiling=budget.coerceAtLeast(1800)
        fun current()=recent.lastOrNull()?.role=="user"
        fun system():String {
            val count=recent.size-(if(current())1 else 0)
            return listOf(base,block("custom",instructions),block("user_portrait",userPortrait),block("global_excerpt",selfPortrait),
                block("dogtalk",dog),block("cross_window",crossWindow),block("soil",soil),items("memory",memory),items("worldbook",world),
                block("reality",reality),block("response_mode",responseMode),
                guides.getValue("external")+"\n本轮没有递入外部材料。",
                if(count>0)guides.getValue("recent")+"\n以下 "+count+" 条消息属于最近上下文。"else "",
                if(current())guides.getValue("current")else "").filter{it.isNotBlank()}.joinToString("\n\n")
        }
        fun total()=estimate(system())+recent.sumOf{estimate(it.content)+4}+imageCount*2048
        while(total()>ceiling&&world.size>2){world.removeAt(world.lastIndex);trimmed++}
        while(total()>ceiling&&memory.size>3){memory.removeAt(memory.lastIndex);trimmed++}
        while(total()>ceiling&&world.isNotEmpty()){world.removeAt(world.lastIndex);trimmed++}
        while(total()>ceiling&&memory.isNotEmpty()){memory.removeAt(memory.lastIndex);trimmed++}
        if(total()>ceiling&&soil.length>700){soil=soil.take(700);trimmed++}
        if(total()>ceiling&&soil.isNotEmpty()){soil="";trimmed++}
        if(total()>ceiling&&dog.isNotEmpty()){dog="";trimmed++}
        while(total()>ceiling&&recent.size>4){
            val starts=recent.indices.filter{recent[it].role=="user"||it==0}
            val protectedCount=if(current())2 else 1
            if(starts.size<=protectedCount)break
            val count=starts[1]
            repeat(count){recent.removeAt(0)}
            trimmed+=count
        }
        return Result(listOf(RemoteChatMessage("system",system()))+recent,recent.toList(),body(soil),body(dog),memory.size,world.size,total(),ceiling,trimmed)
    }
}
