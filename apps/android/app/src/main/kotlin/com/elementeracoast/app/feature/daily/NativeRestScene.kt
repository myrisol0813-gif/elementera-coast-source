package com.elementeracoast.app.feature.daily

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import com.elementeracoast.app.core.restbox.*

/** Pixels prepared from canonical SVGs. No View, HTML, browser, or network is involved in drawing.
 * Implementations must cache off the UI thread and expose immutable, Compose-observable snapshots.
 */
internal interface NativeRestImages {
    fun environment(path: String): Bitmap?
    fun furniture(asset: NativeFurnitureAsset, part: NativePaintPart, colors: Map<String, String>): Bitmap?
    fun occupant(role: String, action: String): Bitmap?
}

/** A room is a native scene, not an embedded application. The parent owns page scrolling.
 * Only edit mode consumes drags, and only when an authored furniture object is hit.
 */
@Composable
internal fun NativeRestScene(
    catalogue: NativeSceneCatalogue,
    roomId: String,
    items: List<NativeFurniture>,
    occupants: List<NativeOccupant>,
    images: NativeRestImages,
    editing: Boolean,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    onMove: (String, Double, Double) -> Unit,
    onMoveFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val room = catalogue.rooms.getValue(roomId)
    val layers = catalogue.layers(roomId, items, occupants)
    val currentItems = rememberUpdatedState(items)
    val select = rememberUpdatedState(onSelect)
    val move = rememberUpdatedState(onMove)
    val finish = rememberUpdatedState(onMoveFinished)
    val paint = remember { Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG) }
    val selectionColor = MaterialTheme.colorScheme.primary
    val fallback = MaterialTheme.colorScheme.surfaceVariant
    val gestures = if (editing) Modifier.pointerInput(roomId, catalogue) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (down.isConsumed || size.width == 0 || size.height == 0) return@awaitEachGesture
            val hit = catalogue.hitTest(currentItems.value, down.position.x * room.width / size.width,
                down.position.y * room.height / size.height) ?: return@awaitEachGesture
            down.consume()
            select.value(hit.id)
            var moved = false
            try {
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    if (change.isConsumed) break
                    if (!change.pressed) { change.consume(); break }
                    val delta = change.position - down.position
                    if (moved || delta.getDistance() >= viewConfiguration.touchSlop) {
                        moved = true
                        move.value(hit.id,
                            (hit.x + delta.x * room.width / size.width).coerceIn(-10000.0,10000.0),
                            (hit.y + delta.y * room.height / size.height).coerceIn(-10000.0,10000.0))
                    }
                    change.consume()
                }
            } finally {
                if (moved) finish.value()
            }
        }
    } else Modifier
    Canvas(modifier.fillMaxWidth().aspectRatio((room.width / room.height).toFloat()).then(gestures)) {
        drawRect(fallback)
        drawIntoCanvas { target ->
            val canvas = target.nativeCanvas
            val sx = size.width / room.width.toFloat()
            val sy = size.height / room.height.toFloat()
            fun draw(bitmap: Bitmap?, x: Double, y: Double, w: Double, h: Double, mirror: Boolean = false) {
                if (bitmap == null || bitmap.isRecycled) return
                val rect = RectF((x * sx).toFloat(), (y * sy).toFloat(), ((x + w) * sx).toFloat(), ((y + h) * sy).toFloat())
                val save = canvas.save()
                if (mirror) canvas.scale(-1f, 1f, rect.centerX(), rect.centerY())
                canvas.drawBitmap(bitmap, null, rect, paint)
                canvas.restoreToCount(save)
            }
            val save = canvas.save()
            canvas.clipRect(0f, 0f, size.width, size.height)
            for (layer in layers) when (layer) {
                is NativeSceneLayer.Environment ->
                    draw(images.environment(layer.path), 0.0, 0.0, room.width, room.height)
                is NativeSceneLayer.Furniture -> layer.asset?.let { asset ->
                    val item = layer.item
                    draw(images.furniture(asset, layer.part, item.colors), item.x, item.y,
                        asset.width * item.scale, asset.height * item.scale, item.mirror)
                }
                is NativeSceneLayer.Occupant -> {
                    val bitmap = images.occupant(layer.role, layer.anchor.action)
                    if (bitmap != null && bitmap.height > 0) {
                        val h = 55.0
                        val w = h * bitmap.width / bitmap.height
                        draw(bitmap, layer.anchor.x - w / 2, layer.anchor.y - h / 2, w, h)
                    }
                }
            }
            canvas.restoreToCount(save)
        }
        if (editing) items.firstOrNull { it.id == selectedId && it.visible }?.let { item ->
            catalogue.assets[item.assetId]?.let { asset ->
                val sx = size.width / room.width
                val sy = size.height / room.height
                drawRect(
                    selectionColor,
                    topLeft = androidx.compose.ui.geometry.Offset((item.x * sx).toFloat(), (item.y * sy).toFloat()),
                    size = androidx.compose.ui.geometry.Size((asset.width * item.scale * sx).toFloat(), (asset.height * item.scale * sy).toFloat()),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f),
                )
            }
        }
    }
}
