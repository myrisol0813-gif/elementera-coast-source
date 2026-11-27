package com.elementeracoast.app.feature.daily

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log

/** JNI is a native static SVG engine, not a browser or embedded script runtime. */
internal object NativeSvgRaster {
    private val loaded by lazy { runCatching { System.loadLibrary("coast_native_art") } }
    @JvmStatic private external fun renderPng(svg: String, width: Int, height: Int): ByteArray?

    fun renderChecked(svg:String,width:Int,height:Int):Bitmap {
        require(width in 1..1536 && height in 1..1536 && svg.length<=1_000_000)
        loaded.getOrThrow()
        val bytes=checkNotNull(renderPng(svg,width,height)){"Native SVG rasterizer returned no pixels"}
        return checkNotNull(BitmapFactory.decodeByteArray(bytes,0,bytes.size)){"Native PNG decoding failed"}
    }
    fun render(svg: String, width: Int, height: Int): Bitmap? =
        runCatching { renderChecked(svg,width,height) }.onFailure {
            Log.w("CoastNativeArt","SVG raster failure: "+it.javaClass.simpleName+": "+it.message)
        }.getOrNull()
}
