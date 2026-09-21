package com.elementeracoast.app.feature.daily

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Image codec for the canonical Daily profile contract. Selected Android URIs are never persisted as formal Coast data. */
internal object DailyImageCodec {
    private const val AVATAR_MAX_DATA_URL = 360_000
    private const val COVER_MAX_DATA_URL = 1_200_000
    private const val AVATAR_MAX_DIMENSION = 720
    private const val COVER_MAX_DIMENSION = 1_800

    suspend fun encodeForProfile(
        context: Context,
        uri: Uri,
        field: DailyProfileImageField
    ): String = withContext(Dispatchers.IO) {
        val maxDimension = if (field == DailyProfileImageField.MomentCover) COVER_MAX_DIMENSION else AVATAR_MAX_DIMENSION
        val maxDataUrl = if (field == DailyProfileImageField.MomentCover) COVER_MAX_DATA_URL else AVATAR_MAX_DATA_URL
        val bitmap = decodeSampled(context, uri, maxDimension)
            ?: throw IllegalArgumentException("这张图片无法读取，请换一张再试。")
        encodeWithinLimit(bitmap, maxDimension, maxDataUrl)
    }

    suspend fun decodeForDisplay(context: Context, source: String): ImageBitmap? = withContext(Dispatchers.IO) {
        decodeBitmap(context, source)?.asImageBitmap()
    }

    private fun decodeBitmap(context: Context, source: String): Bitmap? = runCatching {
        if (source.startsWith("data:image/", ignoreCase = true)) {
            val encoded = source.substringAfter(',', "")
            if (encoded.isBlank()) null else {
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        } else {
            context.contentResolver.openInputStream(Uri.parse(source)).use(BitmapFactory::decodeStream)
        }
    }.getOrNull()

    private fun decodeSampled(context: Context, uri: Uri, maxDimension: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (max(bounds.outWidth / sample, bounds.outHeight / sample) > maxDimension * 2) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, options) }
    }

    private fun encodeWithinLimit(source: Bitmap, maxDimension: Int, maxDataUrl: Int): String {
        var working = scaleWithin(source, maxDimension)
        repeat(4) {
            for (quality in intArrayOf(88, 78, 68, 58, 48, 38)) {
                val output = ByteArrayOutputStream()
                working.compress(webpFormat(), quality, output)
                val encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
                val dataUrl = "data:image/webp;base64,$encoded"
                if (dataUrl.length <= maxDataUrl) return dataUrl
            }
            val nextWidth = (working.width * 0.8f).toInt().coerceAtLeast(1)
            val nextHeight = (working.height * 0.8f).toInt().coerceAtLeast(1)
            working = Bitmap.createScaledBitmap(working, nextWidth, nextHeight, true)
        }
        throw IllegalArgumentException("图片压缩后仍然太大，请换一张更小的图片。")
    }

    private fun scaleWithin(source: Bitmap, maxDimension: Int): Bitmap {
        val longest = max(source.width, source.height)
        if (longest <= maxDimension) return source
        val ratio = maxDimension.toFloat() / longest.toFloat()
        return Bitmap.createScaledBitmap(
            source,
            (source.width * ratio).toInt().coerceAtLeast(1),
            (source.height * ratio).toInt().coerceAtLeast(1),
            true
        )
    }

    @Suppress("DEPRECATION")
    private fun webpFormat(): Bitmap.CompressFormat =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
}
