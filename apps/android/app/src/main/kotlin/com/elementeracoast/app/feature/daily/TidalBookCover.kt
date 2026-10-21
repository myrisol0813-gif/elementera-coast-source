package com.elementeracoast.app.feature.daily

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** Cover image never becomes public, nor part of a chat attachment. */
internal suspend fun prepareTidalCover(context: Context, uri: Uri): ByteArray = withContext(Dispatchers.IO) {
    val raw=context.contentResolver.openInputStream(uri)?.use { stream ->
        stream.readNBytes(15*1024*1024+1)
    } ?: throw IllegalArgumentException("无法打开图片。")
    require(raw.isNotEmpty() && raw.size<=15*1024*1024) { "封面源图片最多 15 MB。" }
    val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
    BitmapFactory.decodeByteArray(raw,0,raw.size,bounds)
    require(bounds.outWidth>0 && bounds.outHeight>0) { "无法读取这张封面。" }
    var sample=1
    while(bounds.outWidth/sample>720 || bounds.outHeight/sample>1080) sample*=2
    val bitmap=BitmapFactory.decodeByteArray(raw,0,raw.size,BitmapFactory.Options().apply { inSampleSize=sample })
        ?: throw IllegalArgumentException("无法解析封面图片。")
    try {
        val scale=minOf(1f,360f/bitmap.width,540f/bitmap.height)
        val resized=if(scale<1f)Bitmap.createScaledBitmap(bitmap,
            (bitmap.width*scale).toInt().coerceAtLeast(1),(bitmap.height*scale).toInt().coerceAtLeast(1),true)
            else bitmap
        try {
            for(quality in listOf(86,72,58)) {
                val buffer=ByteArrayOutputStream()
                resized.compress(Bitmap.CompressFormat.JPEG,quality,buffer)
                if(buffer.size()<=600*1024)return@withContext buffer.toByteArray()
            }
            throw IllegalArgumentException("封面仍超过 600 KB，请裁剪后重试。")
        }finally { if(resized !== bitmap)resized.recycle() }
    } finally { bitmap.recycle() }
}

@Composable
internal fun TidalCoverSlot(
    bookId: String,
    hasCover: Boolean,
    revision: Int,
    repository: SideRoomsRepository,
    onClick: () -> Unit
) {
    var cover by remember(bookId,revision) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(bookId,hasCover,revision) {
        cover=if(hasCover)runCatching {
            val bytes=repository.bookCover(bookId)
            withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes,0,bytes.size) }
        }.getOrNull() else null
    }
    Surface(
        modifier=Modifier.size(width=88.dp,height=124.dp).clickable(onClick=onClick),
        color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.35f),
        shape=RoundedCornerShape(13.dp),
        tonalElevation=0.dp
    ) {
        val borderColor=MaterialTheme.colorScheme.outline.copy(alpha=.55f)
        Box(contentAlignment=Alignment.Center) {
            if(cover==null) Canvas(modifier=Modifier.fillMaxSize()) {
                drawRoundRect(color=borderColor,cornerRadius=CornerRadius(13.dp.toPx()),
                    style=Stroke(width=1.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(7.dp.toPx(),5.dp.toPx()))))
            }
            if(cover!=null){
                Image(bitmap=cover!!.asImageBitmap(),contentDescription="封面，点击更换",
                    modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Crop)
            }else{
                Text("＋",fontSize=26.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
