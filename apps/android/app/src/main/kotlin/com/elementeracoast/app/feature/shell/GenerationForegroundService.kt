package com.elementeracoast.app.feature.shell

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.elementeracoast.app.MainActivity
import java.util.UUID

/**
 * User-started network generation: keep the process at foreground-service
 * priority while the existing ViewModel owns the single generation coroutine.
 * Never restart inference, duplicate tool calls or start work from a timer.
 */
class GenerationForegroundService : Service() {
    private var started = false
    private var lastStartId = 0
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        instance = this
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "回复生成与整理", NotificationManager.IMPORTANCE_LOW).apply {
            description = "仅在你发起的回复或思维壤整理尚未结束时显示。"
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        if (intent?.action == ACTION_CANCEL) {
            registry.cancel(intent.getStringExtra(EXTRA_TOKEN).orEmpty())
            if (registry.current() == null) stopSelfResult(startId)
            return START_NOT_STICKY
        }
        // Even if the request completed before Android delivered this start,
        // promote first and then stop; do not leave a pending FGS start.
        try {
            val notification = notification(registry.current()?.token)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else startForeground(NOTIFICATION_ID, notification)
            started = true
            reconcile()
        } catch (_: RuntimeException) {
            registry.current()?.let { if (registry.release(it.token)) it.unavailable() }
            stopSelfResult(startId)
        }
        return START_NOT_STICKY
    }
    private fun notification(token: String?): Notification {
        val open = PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_IMMUTABLE)
        val builder=Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(applicationInfo.loadLabel(packageManager))
            .setContentText("正在书写或整理本轮资料……")
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setProgress(0,0,true)
        if (token != null) {
            val stopIntent=Intent(this,GenerationForegroundService::class.java).setAction(ACTION_CANCEL)
                .setData(Uri.parse("coast-generation://cancel/$token")).putExtra(EXTRA_TOKEN,token)
            val stop=PendingIntent.getService(this,0,stopIntent,PendingIntent.FLAG_IMMUTABLE)
            builder.addAction(Notification.Action.Builder(null,"停止本轮",stop).build())
        }
        return builder.build()
    }
    private fun reconcile() {
        if (!started) return
        if (registry.current() == null) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelfResult(lastStartId)
        }
    }
    override fun onDestroy() {
        if (instance === this) {
            instance = null
            registry.current()?.let { if (registry.release(it.token)) it.unavailable() }
        }
        super.onDestroy()
    }
    companion object {
        private const val CHANNEL="coast_generation_v1"
        private const val NOTIFICATION_ID=4107
        private const val ACTION_START="com.elementeracoast.GENERATION_START"
        private const val ACTION_CANCEL="com.elementeracoast.GENERATION_CANCEL"
        private const val EXTRA_TOKEN="generation_token"
        private val registry=GenerationLeaseRegistry()
        private val main=Handler(Looper.getMainLooper())
        private var instance:GenerationForegroundService?=null

        /** Must be invoked by the visible UI before starting its network job. */
        internal fun acquire(context:Context,cancel:()->Unit,unavailable:()->Unit):AutoCloseable? {
            val token=UUID.randomUUID().toString()
            if(!registry.acquire(GenerationLeaseRegistry.Lease(token,cancel,unavailable))) {
                unavailable()
                return null
            }
            try {
                context.applicationContext.startForegroundService(Intent(context,GenerationForegroundService::class.java)
                    .setAction(ACTION_START).putExtra(EXTRA_TOKEN,token))
            } catch (_:RuntimeException) {
                registry.release(token)
                unavailable()
                return null
            }
            return AutoCloseable {
                if(registry.release(token))main.post { instance?.reconcile() }
            }
        }
    }
}
