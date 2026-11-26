package com.elementeracoast.app.feature.wolf

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

internal enum class ModelKind(val label:String){ Chat("聊天模型"), Image("生图模型"), Voice("语音模型") }
internal enum class ImageGroup(val label:String){ Gpt("GPT"), Other("其他模型"), Free("Free") }

internal fun imageGroup(id:String):ImageGroup {
    val raw=localRawModelId(id).lowercase()
    return when {
        raw.endsWith(":free") -> ImageGroup.Free
        raw.startsWith("openai/") || raw.substringAfterLast('/').startsWith("gpt-") -> ImageGroup.Gpt
        else -> ImageGroup.Other
    }
}

@Composable
internal fun ModelKindTabs(kind:ModelKind,onSelect:(ModelKind)->Unit) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){
        ModelKind.entries.forEach { value ->
            Surface(modifier=Modifier.weight(1f).clickable{onSelect(value)},shape=RoundedCornerShape(16.dp),
                color=if(kind==value)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.55f)){
                Box(Modifier.padding(vertical=12.dp),contentAlignment=Alignment.Center){Text(value.label,style=MaterialTheme.typography.labelMedium)}
            }
        }
    }
}

@Composable
internal fun CurrentImageCard(current:String){
    Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.6f)){
        Column(Modifier.fillMaxWidth().padding(14.dp),verticalArrangement=Arrangement.spacedBy(5.dp)){
            Text("当前生图模型",style=MaterialTheme.typography.labelMedium)
            Text(localRawModelId(current).ifBlank{"尚未选择"},style=MaterialTheme.typography.titleMedium)
            Text("独立图片 API · 使用已配置供应商正常计费",style=MaterialTheme.typography.bodySmall)
        }
    }
}

internal fun LazyListScope.imageModelItems(models:List<String>,current:String,query:String,open:Set<ImageGroup>,toggle:(ImageGroup)->Unit,pick:(String)->Unit){
    val filtered=models.distinct().filter{it.contains(query,ignoreCase=true)}
    if(filtered.isEmpty())item(key="image-empty"){Text("暂无符合条件的生图模型，请刷新目录。",style=MaterialTheme.typography.bodySmall)}
    ImageGroup.entries.forEach{group->
        val entries=filtered.filter{imageGroup(it)==group}
        if(entries.isNotEmpty()){
            val expanded=query.isNotBlank()||group in open
            item(key="image-group:"+group.name){
                Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.55f),RoundedCornerShape(16.dp)).clickable{toggle(group)}.padding(13.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(group.label,Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
                    Text("${entries.size}  "+if(expanded)"⌃" else "⌄")
                }
            }
            if(expanded)items(entries,key={"image-model:"+it}){id->
                Surface(shape=RoundedCornerShape(16.dp),color=if(id==current)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.35f)){
                    Row(Modifier.fillMaxWidth().clickable{pick(id)}.padding(12.dp),verticalAlignment=Alignment.CenterVertically){
                        Text(localRawModelId(id),Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                        Text(if(id==current)"当前" else "选择",style=MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
internal fun OnlineVoiceInfo(){
    Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.6f)){
        Column(Modifier.fillMaxWidth().padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text("语音 · ElevenLabs",style=MaterialTheme.typography.titleMedium)
            Text("在线模式由部署者配置语音服务；本机密钥不会上传。",style=MaterialTheme.typography.bodySmall)
        }
    }
}
