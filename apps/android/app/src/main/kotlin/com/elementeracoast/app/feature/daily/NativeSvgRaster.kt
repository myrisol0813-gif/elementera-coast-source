package com.elementeracoast.app.feature.daily

import android.graphics.Bitmap
import android.graphics.BitmapFactory

/** JNI is a native static SVG engine, not a browser or embedded script runtime. */
internal object NativeSvgRaster {
    private val available by lazy { runCatching { System.loadLibrary("coast_native_art") }.isSuccess }
    @JvmStatic private external fun renderPng(svg: String, width: Int, height: Int): ByteArray?

    fun render(svg: String, width: Int, height: Int): Bitmap? {
        if (!available || width !in 1..1536 || height !in 1..1536 || svg.length > 1_000_000) return null
        val bytes = runCatching { renderPng(svg, width, height) }.getOrNull() ?: return null
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }
}
