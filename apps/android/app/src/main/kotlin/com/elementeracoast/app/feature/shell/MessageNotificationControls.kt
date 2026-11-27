package com.elementeracoast.app.feature.shell

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.elementeracoast.app.core.local.CoastMessageNotifications as ChatNotice
import com.elementeracoast.app.core.local.LocalDreamNotifications as DreamNotice

@Composable
internal fun MessageNotificationControls(){
    val context=LocalContext.current.applicationContext
    var enabled by remember{mutableStateOf(ChatNotice.enabled(context))}
    var always by remember{mutableStateOf(ChatNotice.always(context))}
    var preview by remember{mutableStateOf(ChatNotice.preview(context))}
    var public by remember{mutableStateOf(ChatNotice.publicContent(context))}
    var status by remember{mutableStateOf("")}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){
        status=if(DreamNotice.permitted(context))"通知权限已允许。"else "系统尚未允许通知。"
    }
    LaunchedEffect(context){ChatNotice.ensure(context)}
    com.elementeracoast.app.ui.theme.SnowLetterSurface(modifier=Modifier.fillMaxWidth(),role=com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole.StatusCard,fallbackColor=MaterialTheme.colorScheme.surface,fallbackBorder=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant.copy(alpha=.55f)),fallbackElevation=1.dp){
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text("通知设置",style=MaterialTheme.typography.titleMedium)
            NoticeToggle("每条正式聊天回复",enabled){ChatNotice.setFlag(context,"enabled",it);enabled=it}
            NoticeToggle("前台也通知（关闭则仅后台或锁屏）",always){ChatNotice.setFlag(context,"always",it);always=it}
            Text("聊天及自主手记的正文显示",style=MaterialTheme.typography.bodyMedium)
            listOf("none" to "仅提醒","short" to "文字预览（160 字符）","full" to "尽可能完整（最多4000字符）").forEach{(value,label)->
                Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
                    RadioButton(selected=preview==value,onClick={ChatNotice.setPreview(context,value);preview=value})
                    Text(label)
                }
            }
            NoticeToggle("允许锁屏公开正文",public){ChatNotice.setFlag(context,"public",it);public=it}
            Text("默认隐藏锁屏正文。打开此项后，旁人可能直接看到聊天或手记；最终显示仍取决于系统。媒体以附件提示显示。",style=MaterialTheme.typography.bodySmall)
            TextButton(onClick={runCatching{ChatNotice.channelSettings(context)}.onFailure{status="请在系统设置中调整聊天通知类别。"}}){Text("聊天铃声 · 震动 · 弹条 · 锁屏")}
            TextButton(onClick={
                if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                else runCatching{DreamNotice.appSettings(context)}.onFailure{status="无法打开系统通知设置。"}
            }){Text("允许通知 / 系统通知设置")}
            TextButton(onClick={status=if(ChatNotice.test(context))"已提交测试通知，请查看通知栏。"else "未能发送，请检查系统通知权限和类别设置。"}){Text("测试通知（不调用模型）")}
            if(status.isNotBlank())Text(status,style=MaterialTheme.typography.bodySmall)
            Text("本机及在线 APK 在收到消息保存回执后通知；应用被强停或任务终止后不保证收到。自主唤醒类别开关仍在唤醒设置中。",style=MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable private fun NoticeToggle(label:String,checked:Boolean,onChange:(Boolean)->Unit){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
        Text(label,modifier=Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
        Switch(checked=checked,onCheckedChange=onChange)
    }
}
