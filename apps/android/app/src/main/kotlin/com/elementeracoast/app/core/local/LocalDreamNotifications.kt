package com.elementeracoast.app.core.local

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.elementeracoast.app.MainActivity

/** Device-only alerts. Never starts model work; no private note or window title leaves the app. */
internal object LocalDreamNotifications {
    private const val ACTION="com.elementeracoast.LOCAL_DREAM_NOTICE"
    private const val PREFS="coast_dream_notifications_v1"
    const val NOTE="note"
    const val FAILURE="failure"
    const val START="start"
    data class Target(val cid:String,val claim:String,val tab:Int)
    private fun manager(c:Context)=c.getSystemService(NotificationManager::class.java)
    private fun prefs(c:Context)=c.getSharedPreferences(PREFS,Context.MODE_PRIVATE)
    private fun channel(kind:String)="coast_dream_${kind}_v1"
    fun enabled(c:Context,kind:String)=prefs(c).getBoolean(kind,kind!=START)
    fun setEnabled(c:Context,kind:String,value:Boolean){prefs(c).edit().putBoolean(kind,value).apply()}
    fun permitted(c:Context)= (Build.VERSION.SDK_INT<33||c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)&&manager(c).areNotificationsEnabled()
    fun ensure(c:Context){
        val audio=AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
        listOf(NOTE to "自主唤醒 · 新自主手记",FAILURE to "自主唤醒 · 活动异常",START to "自主唤醒 · 开始活动").forEach{(kind,name)->
            manager(c).createNotificationChannel(NotificationChannel(channel(kind),name,NotificationManager.IMPORTANCE_HIGH).apply{
                description="仅通知本机已记录的自主活动；不会触发模型调用。"
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),audio)
                enableVibration(true)
                lockscreenVisibility=Notification.VISIBILITY_PRIVATE
            })
        }
    }
    fun channelSettings(c:Context,kind:String){
        ensure(c)
        c.startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE,c.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID,channel(kind)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    fun appSettings(c:Context){
        c.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE,c.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    fun target(intent:Intent?):Target?{
        if(intent?.action!=ACTION)return null
        val data=intent.data?:return null
        if(data.scheme!="coast-dream"||data.host!="notice"||data.pathSegments.size!=3)return null
        val (cid,claim,kind)=data.pathSegments
        if(cid.isBlank()||cid.length>180||claim.length>180)return null
        return Target(cid,claim,when(kind){NOTE->1;START,FAILURE->2;"test"->0;else->return null})
    }
    /** One stable tag per persisted claim and event. Reposting cannot stack duplicate alerts. */
    fun post(c:Context,cid:String,claim:String,kind:String):Boolean=runCatching{
        if(kind !in setOf(NOTE,FAILURE,START,"test"))return false
        if(kind!="test"&&!enabled(c,kind))return false
        ensure(c)
        val ch=channel(if(kind=="test")NOTE else kind)
        if(!permitted(c)||manager(c).getNotificationChannel(ch)?.importance==NotificationManager.IMPORTANCE_NONE)return false
        val intent=Intent(c,MainActivity::class.java).setAction(ACTION)
            .setData(Uri.Builder().scheme("coast-dream").authority("notice").appendPath(cid).appendPath(claim).appendPath(kind).build())
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val open=PendingIntent.getActivity(c,0,intent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text=when(kind){NOTE->"有一份新的自主手记，打开看看吧。";FAILURE->"有一次活动未完成，请查看记录。";START->"一次活动已经开始。";else->"这是一条测试通知，没有调用模型。"}
        val title=when(kind){NOTE->"新的自主手记";FAILURE->"自主唤醒 · 活动异常";START->"自主唤醒 · 开始活动";else->"自主唤醒 · 测试通知"}
        val public=Notification.Builder(c,ch).setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(c.applicationInfo.loadLabel(c.packageManager)).setContentText("有一条新通知")
            .setVisibility(Notification.VISIBILITY_PUBLIC).build()
        val notification=Notification.Builder(c,ch).setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title).setContentText(text).setContentIntent(open).setAutoCancel(true)
            .setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(public)
            .setCategory(Notification.CATEGORY_MESSAGE).build()
        val tag="coast-dream:$cid:$claim:$kind"
        if(kind=="test")manager(c).cancel(tag,4218)
        manager(c).notify(tag,4218,notification)
        true
    }.getOrDefault(false)
}
