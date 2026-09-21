package com.elementeracoast.app.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp

@Immutable
data class SnowLetterVisualSettings(
    val chatBackgroundAlpha: Float = .88f,
    val decorationAlpha: Float = .78f,
    val paperTextureAlpha: Float = .36f
)

val LocalSnowLetterVisuals = staticCompositionLocalOf { SnowLetterVisualSettings() }

fun CoastThemePreset.usesSnowLetterDecorations(): Boolean = this == CoastThemePreset.SnowLetter

@Composable
fun SnowLetterChatScaffold(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val enabled = LocalCoastAppearance.current.preset.usesSnowLetterDecorations()
    Box(modifier = modifier.background(MaterialTheme.colorScheme.background)) {
        if (enabled) SnowLetterPageTemplate(Modifier.fillMaxSize(), forFeature = false)
        content()
    }
}

@Composable
fun SnowLetterFeatureScaffold(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val enabled = LocalCoastAppearance.current.preset.usesSnowLetterDecorations()
    Box(modifier = modifier.background(MaterialTheme.colorScheme.background)) {
        if (enabled) SnowLetterPageTemplate(Modifier.fillMaxSize(), forFeature = true)
        content()
    }
}

@Composable
private fun SnowLetterPageTemplate(
    modifier: Modifier = Modifier,
    forFeature: Boolean
) {
    val settings = LocalSnowLetterVisuals.current
    Canvas(modifier) {
        val paperAlpha = settings.chatBackgroundAlpha.coerceIn(0f, 1f) * if (forFeature) .96f else .92f
        val decorAlpha = settings.decorationAlpha.coerceIn(0f, 1f)
        drawSnowLetterBackdrop(paperAlpha, decorAlpha, forFeature)
    }
}

private val SnowBlue = Color(0xFFAFC4D8)
private val PaperCream = Color(0xFFFFFEFA)
private val OldGold = Color(0xFFD7A84D)
private val ShadowBlue = Color(0xFFB7C8D8)

private fun DrawScope.drawSnowLetterBackdrop(
    paperAlpha: Float,
    decorationAlpha: Float,
    forFeature: Boolean
) {
    drawRect(Color(0xFFF5F9FC))

    val marginX = if (forFeature) 12.dp.toPx() else 10.dp.toPx()
    val marginTop = if (forFeature) 8.dp.toPx() else 6.dp.toPx()
    val marginBottom = if (forFeature) 8.dp.toPx() else 2.dp.toPx()
    val sheet = RectSpec(marginX, marginTop, size.width - marginX, size.height - marginBottom)

    drawTornPaper(sheet.shift(3.dp.toPx(), 5.dp.toPx()), ShadowBlue.copy(alpha = .20f * paperAlpha), Color.Transparent, .5f)
    drawTornPaper(sheet, PaperCream.copy(alpha = .96f * paperAlpha), SnowBlue.copy(alpha = .30f * paperAlpha), 1f)
    drawStationeryMarks(sheet, decorationAlpha * paperAlpha)
}

private fun DrawScope.drawTornPaper(rect: RectSpec, fill: Color, stroke: Color, wobbleScale: Float) {
    val path = tornRectPath(rect, wobbleScale)
    drawPath(path, fill)
    if (stroke.alpha > 0f) drawPath(path, stroke, style = Stroke(width = 1.dp.toPx()))
}

private fun DrawScope.tornRectPath(rect: RectSpec, wobbleScale: Float): Path {
    val step = 22.dp.toPx()
    val wobble = 2.6.dp.toPx() * wobbleScale
    val path = Path()
    path.moveTo(rect.left + 10.dp.toPx(), rect.top)
    var x = rect.left + 10.dp.toPx()
    var i = 0
    while (x < rect.right - 10.dp.toPx()) {
        x = (x + step).coerceAtMost(rect.right - 10.dp.toPx())
        path.lineTo(x, rect.top + ((i % 3) - 1) * wobble)
        i += 1
    }
    var y = rect.top + 10.dp.toPx()
    while (y < rect.bottom - 10.dp.toPx()) {
        y = (y + step).coerceAtMost(rect.bottom - 10.dp.toPx())
        path.lineTo(rect.right + ((i % 3) - 1) * wobble, y)
        i += 1
    }
    x = rect.right - 10.dp.toPx()
    while (x > rect.left + 10.dp.toPx()) {
        x = (x - step).coerceAtLeast(rect.left + 10.dp.toPx())
        path.lineTo(x, rect.bottom + ((i % 3) - 1) * wobble)
        i += 1
    }
    y = rect.bottom - 10.dp.toPx()
    while (y > rect.top + 10.dp.toPx()) {
        y = (y - step).coerceAtLeast(rect.top + 10.dp.toPx())
        path.lineTo(rect.left + ((i % 3) - 1) * wobble, y)
        i += 1
    }
    path.close()
    return path
}

private fun DrawScope.drawStationeryMarks(rect: RectSpec, alpha: Float) {
    drawPaperclip(Offset(rect.left + 30.dp.toPx(), rect.top + 28.dp.toPx()), alpha)
}

private fun DrawScope.drawPaperclip(center: Offset, alpha: Float) {
    rotate(degrees = -20f, pivot = center) {
        drawRoundRect(
            color = OldGold.copy(alpha = .55f * alpha),
            topLeft = center + Offset(-7.dp.toPx(), -22.dp.toPx()),
            size = Size(14.dp.toPx(), 44.dp.toPx()),
            cornerRadius = CornerRadius(8.dp.toPx(), 8.dp.toPx()),
            style = Stroke(width = 2.dp.toPx())
        )
        drawRoundRect(
            color = OldGold.copy(alpha = .40f * alpha),
            topLeft = center + Offset(-3.dp.toPx(), -15.dp.toPx()),
            size = Size(7.dp.toPx(), 30.dp.toPx()),
            cornerRadius = CornerRadius(5.dp.toPx(), 5.dp.toPx()),
            style = Stroke(width = 1.3.dp.toPx())
        )
    }
}

private data class RectSpec(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    fun shift(dx: Float, dy: Float) = RectSpec(left + dx, top + dy, right + dx, bottom + dy)
}