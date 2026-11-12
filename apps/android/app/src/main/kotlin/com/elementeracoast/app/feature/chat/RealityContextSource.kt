package com.elementeracoast.app.feature.chat

import android.Manifest
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Geocoder
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Process
import androidx.core.content.ContextCompat
import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.core.model.ConversationContextSettings
import com.elementeracoast.app.core.model.RealityContextFields
import com.elementeracoast.app.core.remote.RemoteRealityApp
import com.elementeracoast.app.core.remote.RemoteRealityAppUsage
import com.elementeracoast.app.core.remote.RemoteRealityBattery
import com.elementeracoast.app.core.remote.RemoteRealityContext
import com.elementeracoast.app.core.remote.RemoteRealityLocation
import com.elementeracoast.app.core.remote.RemoteRealitySteps
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

interface RealityContextSource {
    suspend fun capture(settings: ConversationContextSettings): RemoteRealityContext
}

class AndroidRealityContextSource(
    context: Context,
    private val persistence: LocalPersistence
) : RealityContextSource {
    private val app = context.applicationContext

    override suspend fun capture(settings: ConversationContextSettings): RemoteRealityContext =
        withContext(Dispatchers.IO) {
            val clean = settings.normalized()
            if (!clean.realityEnabled) return@withContext RemoteRealityContext()
            val wantsUsage = clean.has(RealityContextFields.RECENT_APP) || clean.has(RealityContextFields.APP_USAGE)
            RemoteRealityContext(
                timezone = if (clean.has(RealityContextFields.TIME)) ZoneId.systemDefault().id else "",
                battery = if (clean.has(RealityContextFields.BATTERY)) battery() else null,
                location = if (clean.has(RealityContextFields.LOCATION)) coarseLocation() else null,
                recentApp = if (wantsUsage && hasUsageAccess(app)) recentApp() else null,
                appUsage = if (clean.has(RealityContextFields.APP_USAGE) && hasUsageAccess(app)) appUsageToday() else emptyList(),
                steps = if (clean.has(RealityContextFields.STEPS)) stepsToday() else null
            )
        }

    private fun battery(): RemoteRealityBattery? {
        val intent = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return null
        val percent = ((level.toDouble() / scale.toDouble()) * 100.0).roundToInt().coerceIn(0, 100)
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = when (status) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
            else -> null
        }
        return RemoteRealityBattery(percent, charging)
    }

    private fun recentApp(): RemoteRealityApp? {
        val manager = app.getSystemService(UsageStatsManager::class.java) ?: return null
        val now = System.currentTimeMillis()
        val events = manager.queryEvents(now - 24L * 60L * 60L * 1000L, now)
        val event = UsageEvents.Event()
        var latestPackage = ""
        var latestAt = Long.MIN_VALUE
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val foreground = event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && event.eventType == UsageEvents.Event.ACTIVITY_RESUMED)
            if (!foreground || event.packageName == app.packageName || event.packageName.isNullOrBlank()) continue
            if (event.timeStamp >= latestAt) {
                latestAt = event.timeStamp
                latestPackage = event.packageName
            }
        }
        return latestPackage.takeIf(String::isNotBlank)?.let { RemoteRealityApp(appLabel(it)) }
    }

    private fun appUsageToday(): List<RemoteRealityAppUsage> {
        val manager = app.getSystemService(UsageStatsManager::class.java) ?: return emptyList()
        val zone = ZoneId.systemDefault()
        val start = LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli()
        val now = System.currentTimeMillis()
        return manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now)
            .orEmpty()
            .asSequence()
            .filter { it.packageName != app.packageName && it.totalTimeInForeground > 0L }
            .groupBy { it.packageName }
            .map { (packageName, rows) -> packageName to rows.sumOf { it.totalTimeInForeground } }
            .sortedByDescending { it.second }
            .take(APP_USAGE_LIMIT)
            .map { (packageName, millis) ->
                RemoteRealityAppUsage(
                    name = appLabel(packageName),
                    minutes = (millis / 60_000L).toInt().coerceAtLeast(1).coerceAtMost(1440)
                )
            }
    }

    @Suppress("DEPRECATION")
    private fun coarseLocation(): RemoteRealityLocation? {
        if (!hasCoarseLocationPermission(app)) return null
        val manager = app.getSystemService(LocationManager::class.java) ?: return null
        val location = listOf(
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER,
            LocationManager.GPS_PROVIDER
        ).mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time } ?: return null
        val geocoded = runCatching {
            Geocoder(app, Locale.getDefault()).getFromLocation(location.latitude, location.longitude, 1)?.firstOrNull()
        }.getOrNull()
        val label = geocoded?.let { address ->
            listOf(address.locality, address.subAdminArea, address.adminArea, address.countryName)
                .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
                .distinct().take(3).joinToString(" · ")
        }.orEmpty()
        if (label.isBlank()) return null
        return RemoteRealityLocation(label.take(120))
    }

    private suspend fun stepsToday(): RemoteRealitySteps? {
        if (!hasActivityRecognitionPermission(app)) return null
        val sensorManager = app.getSystemService(SensorManager::class.java) ?: return null
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
        val reading = withTimeoutOrNull(1800L) {
            suspendCancellableCoroutine<Float?> { continuation ->
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        sensorManager.unregisterListener(this)
                        if (continuation.isActive) continuation.resume(event.values.firstOrNull())
                    }
                    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
                }
                if (!sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)) {
                    continuation.resume(null)
                } else {
                    continuation.invokeOnCancellation { sensorManager.unregisterListener(listener) }
                }
            }
        } ?: return null
        val current = reading ?: return null
        val day = LocalDate.now().toString()
        val key = "reality.steps.baseline.$day"
        val baseline = persistence.get(key).toFloatOrNull()
        if (baseline == null || current < baseline) {
            persistence.put(key, current.toString())
            return null
        }
        return RemoteRealitySteps(
            count = (current - baseline).roundToInt().coerceAtLeast(0),
            basis = "自本日首次读取后"
        )
    }

    private fun appLabel(packageName: String): String {
        val manager = app.packageManager
        return runCatching {
            val info = manager.getApplicationInfo(packageName, 0)
            manager.getApplicationLabel(info).toString().trim()
        }.getOrNull().orEmpty().ifBlank { packageName }
    }

    companion object {
        const val APP_USAGE_LIMIT = 5
        fun hasUsageAccess(context: Context): Boolean {
            val appOps = context.getSystemService(AppOpsManager::class.java) ?: return false
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
            }
            return mode == AppOpsManager.MODE_ALLOWED
        }
        fun hasActivityRecognitionPermission(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
        fun hasCoarseLocationPermission(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
