package com.elementeracoast.app.ui.theme

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Wide, low-amplitude cloud lobes. The outline is drawn at the measured bubble size:
 * long text extends the sides instead of stretching a raster cloud or clipping glyphs.
 * Selected by the shared paper-mode control for all compatible surfaces.
 */
internal object CoastCloudShape : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val path = Path()
        val width = size.width
        val height = size.height
        if (width <= 0f || height <= 0f) return Outline.Generic(path)

        val corner = minOf(with(density) { 20.dp.toPx() }, width * .22f, height * .32f)
        val inset = minOf(with(density) { 5.dp.toPx() }, width * .06f, height * .12f)
        val topLobes = coastCloudLobeCount(width - 2f * corner, with(density) { 88.dp.toPx() }, 5)
        val sideLobes = coastCloudLobeCount(height - 2f * corner, with(density) { 110.dp.toPx() }, 9)
        val topSpan = (width - 2f * corner) / topLobes
        val sideSpan = (height - 2f * corner) / sideLobes

        path.moveTo(corner, inset)
        repeat(topLobes) { index ->
            val x0 = corner + topSpan * index
            val x1 = corner + topSpan * (index + 1)
            val crest = if (index % 3 == 1) inset * .35f else 0f
            path.cubicTo(x0 + topSpan * .22f, crest, x1 - topSpan * .22f, crest, x1, inset)
        }

        path.cubicTo(width - corner * .35f, inset, width - inset, corner * .43f, width - inset, corner)
        repeat(sideLobes) { index ->
            val y0 = corner + sideSpan * index
            val y1 = corner + sideSpan * (index + 1)
            path.cubicTo(width, y0 + sideSpan * .26f, width, y1 - sideSpan * .26f, width - inset, y1)
        }
        path.cubicTo(width - inset, height - corner * .43f, width - corner * .35f, height - inset, width - corner, height - inset)

        repeat(topLobes) { index ->
            val x0 = width - corner - topSpan * index
            val x1 = width - corner - topSpan * (index + 1)
            val trough = if (index % 3 == 1) height - inset * .35f else height
            path.cubicTo(x0 - topSpan * .22f, trough, x1 + topSpan * .22f, trough, x1, height - inset)
        }

        path.cubicTo(corner * .35f, height - inset, inset, height - corner * .43f, inset, height - corner)
        repeat(sideLobes) { index ->
            val y0 = height - corner - sideSpan * index
            val y1 = height - corner - sideSpan * (index + 1)
            path.cubicTo(0f, y0 - sideSpan * .26f, 0f, y1 + sideSpan * .26f, inset, y1)
        }
        path.cubicTo(inset, corner * .43f, corner * .35f, inset, corner, inset)
        path.close()
        return Outline.Generic(path)
    }
}

/** Pure sizing rule shared by every edge; bounded for long streamed messages. */
internal fun coastCloudLobeCount(spanPx: Float, preferredPx: Float, maximum: Int): Int =
    if (spanPx <= 0f || preferredPx <= 0f) 1
    else (spanPx / preferredPx).roundToInt().coerceIn(1, maximum.coerceAtLeast(1))
