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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.elementeracoast.app.core.local.LocalDreamNotifications as Notices

@Composable
internal fun DreamNotificationControls(cid:String){
    val context=LocalContext.current
    val app=context.applicationContext
    var permitted by remember{mutableStateOf(Notices.permitted(app))}
    var status by remember{mutableStateOf("")}
    var note by remember{mutableStateOf(Notices.enabled(app,Notices.NOTE))}
    var failure by remember{mutableStateOf(Notices.enabled(app,Notices.FAILURE))}
    var start by remember{mutableStateOf(Notices.enabled(app,Notices.START))}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){permitted=Notices.permitted(app)}
    LaunchedEffect(app){Notices.ensure(app)}
    DisposableEffect(context){
        val lifecycle=(context as? LifecycleOwner)?.lifecycle
        val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_RESUME)permitted=Notices.permitted(app)}
        lifecycle?.addObserver(observer)
        onDispose{lifecycle?.removeObserver(observer)}
    }
    com.elementeracoast.app.ui.theme.SnowLetterSurface(modifier=Modifier.fillMaxWidth(),role=com.elementeracoast.app.ui.theme.SnowLetterSurfaceRole.StatusCard,fallbackColor=MaterialTheme.colorScheme.surface,fallbackBorder=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant.copy(alpha=.55f)),fallbackElevation=1.dp){
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text("本机系统通知",style=MaterialTheme.typography.titleMedium)
            Text("应用级设置，适用于本机所有已授权窗口。锁屏默认隐藏私密正文；不影响模型活动或费用。",style=MaterialTheme.typography.bodySmall)
            if(!permitted){
                Text("系统通知尚未允许。",color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
                TextButton(onClick={
                    if(Build.VERSION.SDK_INT>=33 && app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else Notices.appSettings(app)
                }){Text("允许通知")}
            }
            DreamNotificationRow("收到自主手记",note,settings={runCatching{Notices.channelSettings(app,Notices.NOTE)}.onFailure{status="无法打开通知类别，请到系统设置调整。"}},change={Notices.setEnabled(app,Notices.NOTE,it);note=it})
            DreamNotificationRow("活动失败或中断",failure,settings={runCatching{Notices.channelSettings(app,Notices.FAILURE)}.onFailure{status="无法打开通知类别，请到系统设置调整。"}},change={Notices.setEnabled(app,Notices.FAILURE,it);failure=it})
            DreamNotificationRow("开始活动",start,settings={runCatching{Notices.channelSettings(app,Notices.START)}.onFailure{status="无法打开通知类别，请到系统设置调整。"}},change={Notices.setEnabled(app,Notices.START,it);start=it})
            Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
                TextButton(onClick={runCatching{Notices.appSettings(app)}.onFailure{status="无法打开系统设置。"}}){Text("系统通知设置")}
                TextButton(onClick={status=if(Notices.post(app,cid,"test","test"))"已提交测试通知，请查看通知栏。" else "未能发送，请检查系统通知权限和类别设置。"}){Text("测试通知")}
            }
            if(status.isNotBlank())Text(status,style=MaterialTheme.typography.bodySmall)
            Text("是否响铃、震动、显示顶部横幅及锁屏通知由 Android、手机厂商设置和勿扰模式决定。测试不会请求模型。在线模式暂不提供此推送。",style=MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun DreamNotificationRow(label:String,value:Boolean,settings:()->Unit,change:(Boolean)->Unit){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
            Text(label,style=MaterialTheme.typography.bodyMedium)
            TextButton(onClick=settings){Text("铃声 · 震动 · 弹条 · 锁屏")}
        }
        Switch(checked=value,onCheckedChange=change)
    }
}
