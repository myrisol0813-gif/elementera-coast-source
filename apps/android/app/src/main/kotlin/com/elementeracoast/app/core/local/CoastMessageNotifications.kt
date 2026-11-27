package com.elementeracoast.app.core.local

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.elementeracoast.app.MainActivity
import com.elementeracoast.app.core.remote.RemoteVariant

/** Only observes committed replies in the running APK. No network or inference. */
internal object CoastMessageNotifications {
    private const val CHANNEL="coast_chat_reply_v1"
    private const val ACTION="com.elementeracoast.CHAT_NOTICE"
    @Volatile var foreground=false
    data class Target(val cid:String,val local:Boolean)
    private fun prefs(c:Context)=c.getSharedPreferences("coast_message_notices_v1",Context.MODE_PRIVATE)
    private fun manager(c:Context)=c.getSystemService(NotificationManager::class.java)
    fun enabled(c:Context)=prefs(c).getBoolean("enabled",true)
    fun always(c:Context)=prefs(c).getBoolean("always",true)
    fun preview(c:Context)=prefs(c).getString("preview","full")?:"full"
    fun publicContent(c:Context)=prefs(c).getBoolean("public",false)
    fun setFlag(c:Context,key:String,value:Boolean){prefs(c).edit().putBoolean(key,value).apply()}
    fun setPreview(c:Context,value:String){if(value in setOf("none","short","full"))prefs(c).edit().putString("preview",value).apply()}
    fun display(c:Context,body:String,fallback:String):String=when(preview(c)){
        "none"->fallback
        "short"->body.takeIf{it.isNotBlank()}?.let{if(it.length>160)it.take(160)+"…" else it}?:fallback
        else->body.takeIf{it.isNotBlank()}?.let{if(it.length>4000)it.take(4000)+"…（打开查看全文）"else it}?:fallback
    }
    fun ensure(c:Context){
        manager(c).createNotificationChannel(NotificationChannel(CHANNEL,"聊天回复",NotificationManager.IMPORTANCE_HIGH).apply{
            description="每条已保存的正式聊天回复；不额外发起模型调用。"
            enableVibration(true)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
            lockscreenVisibility=Notification.VISIBILITY_PRIVATE
        })
    }
    fun channelSettings(c:Context){
        ensure(c)
        c.startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE,c.packageName).putExtra(Settings.EXTRA_CHANNEL_ID,CHANNEL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    fun target(intent:Intent?):Target?{
        if(intent?.action!=ACTION)return null
        val d=intent.data?:return null
        if(d.scheme!="coast-chat"||d.host!="notice"||d.pathSegments.size!=3)return null
        val (mode,cid,mid)=d.pathSegments
        if(mode !in setOf("local","online")||cid.isBlank()||cid.length>180||mid.isBlank()||mid.length>180)return null
        return Target(cid,mode=="local")
    }
    fun post(c:Context,cid:String,variant:RemoteVariant,local:Boolean):Boolean=runCatching{
        if(!enabled(c))return false
        val locked=c.getSystemService(KeyguardManager::class.java).isKeyguardLocked
        val interactive=c.getSystemService(PowerManager::class.java).isInteractive
        if(!always(c)&&foreground&&interactive&&!locked)return false
        val media=variant.attachments.size
        val body=variant.content+if(media>0)"\n［附件 ${media} 件，打开查看］"else ""
        deliver(c,cid,variant.id,body.trim(),"收到一条新回复",local,false)
    }.getOrDefault(false)
    fun test(c:Context)=runCatching{deliver(c,"test","test","这是一条测试通知，没有调用模型。","测试通知",false,true)}.getOrDefault(false)
    private fun deliver(c:Context,cid:String,mid:String,body:String,title:String,local:Boolean,test:Boolean):Boolean{
        ensure(c)
        if(!LocalDreamNotifications.permitted(c)||manager(c).getNotificationChannel(CHANNEL)?.importance==NotificationManager.IMPORTANCE_NONE)return false
        val mode=if(local)"local"else "online"
        val intent=Intent(c,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if(!test)intent.setAction(ACTION).setData(Uri.Builder().scheme("coast-chat").authority("notice").appendPath(mode).appendPath(cid).appendPath(mid).build())
        val open=PendingIntent.getActivity(c,0,intent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text=display(c,body,if(test)"这是一条测试通知，没有调用模型。"else "打开查看回复。")
        val public=publicContent(c)
        val redacted=Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(c.applicationInfo.loadLabel(c.packageManager)).setContentText(if(public)text else "有一条新通知")
            .setVisibility(Notification.VISIBILITY_PUBLIC).build()
        val notice=Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title).setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(if(public)Notification.VISIBILITY_PUBLIC else Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(redacted).build()
        val tag="coast-chat:$mode:$cid:$mid"
        if(test)manager(c).cancel(tag,4219)
        manager(c).notify(tag,4219,notice)
        return true
    }
}
