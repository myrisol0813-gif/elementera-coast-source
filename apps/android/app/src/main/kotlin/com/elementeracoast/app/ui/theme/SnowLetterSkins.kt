package com.elementeracoast.app.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.min

enum class SnowLetterSurfaceRole {
    AssistantBubble,
    UserBubble,
    ComposerField,
    ComposerButton,
    ActionButton,
    StatusCard,
    DogtalkCard,
    DogtalkField
}

/** Shared paper treatment; compact controls stay smooth even when paper pages use the Snow Letter edge. */
internal fun SnowLetterSurfaceRole.usesLetterPaper(paperMode: CoastPaperMode): Boolean =
    paperMode == CoastPaperMode.Wave && when (this) {
        SnowLetterSurfaceRole.AssistantBubble,
        SnowLetterSurfaceRole.UserBubble,
        SnowLetterSurfaceRole.StatusCard,
        SnowLetterSurfaceRole.DogtalkCard -> true
        SnowLetterSurfaceRole.ComposerField,
        SnowLetterSurfaceRole.ComposerButton,
        SnowLetterSurfaceRole.ActionButton,
        SnowLetterSurfaceRole.DogtalkField -> false
    }

/** Deterministic, shallow torn-paper outline inspired by the original Snow Letter cards. */
internal object SnowLetterPaperShape : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val width = size.width.coerceAtLeast(1f)
        val height = size.height.coerceAtLeast(1f)
        val amplitude = with(density) { 2.2.dp.toPx() }.coerceAtMost(min(width, height) * .06f)
        val step = with(density) { 28.dp.toPx() }.coerceAtLeast(8f)
        val path = Path()

        fun inset(index: Int): Float = when (index % 6) {
            0 -> amplitude * .30f
            1 -> amplitude * .82f
            2 -> amplitude * .44f
            3 -> amplitude
            4 -> amplitude * .56f
            else -> amplitude * .72f
        }

        path.moveTo(0f, inset(0))
        var index = 0
        var x = 0f
        while (x < width) {
            x = (x + step).coerceAtMost(width)
            path.lineTo(x, inset(index++))
        }

        var y = 0f
        while (y < height) {
            y = (y + step).coerceAtMost(height)
            path.lineTo(width - inset(index++), y)
        }

        x = width
        while (x > 0f) {
            x = (x - step).coerceAtLeast(0f)
            path.lineTo(x, height - inset(index++))
        }

        y = height
        while (y > 0f) {
            y = (y - step).coerceAtLeast(0f)
            path.lineTo(inset(index++), y)
        }
        path.close()
        return Outline.Generic(path)
    }
}

@Composable
fun SnowLetterSurface(
    modifier: Modifier = Modifier,
    role: SnowLetterSurfaceRole,
    fallbackColor: Color,
    fallbackShape: Shape = RoundedCornerShape(18.dp),
    fallbackBorder: BorderStroke? = null,
    fallbackElevation: Dp = 0.dp,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable BoxScope.() -> Unit
) {
    val appearance = LocalCoastAppearance.current
    val isMessageSurface = role == SnowLetterSurfaceRole.AssistantBubble || role == SnowLetterSurfaceRole.UserBubble
    val messageAlpha = appearance.messageSurfaceAlpha.coerceIn(.55f, 1f)
    val isLetter = role.usesLetterPaper(appearance.paperMode)

    // Wave restores the original Snow Letter paper edge on actual paper surfaces.
    // User messages intentionally keep their compact rounded silhouette and custom color.
    val surfaceModifier = if (isLetter) {
        val paperShape = if (role == SnowLetterSurfaceRole.UserBubble) fallbackShape else SnowLetterPaperShape
        val paperFill = when (role) {
            SnowLetterSurfaceRole.UserBubble -> appearance.userBubbleColor ?: fallbackColor
            SnowLetterSurfaceRole.AssistantBubble -> MaterialTheme.colorScheme.surface
            else -> fallbackColor
        }
        val paperAlpha = if (isMessageSurface) messageAlpha else 1f
        val shadowTint = Color(0xFF8495A6)
        Modifier
            .shadow(
                elevation = if (fallbackElevation.value > 0f) fallbackElevation else 2.dp,
                shape = paperShape,
                clip = false,
                ambientColor = shadowTint.copy(alpha = .10f * paperAlpha),
                spotColor = shadowTint.copy(alpha = .07f * paperAlpha)
            )
            .background(paperFill.copy(alpha = paperFill.alpha * paperAlpha), paperShape)
            .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .23f * paperAlpha), paperShape)
    } else {
        val color = if (isMessageSurface) fallbackColor.copy(alpha = fallbackColor.alpha * messageAlpha) else fallbackColor
        Modifier
            .optionalShadow(fallbackElevation, fallbackShape)
            .background(color, fallbackShape)
            .then(if (fallbackBorder != null) Modifier.border(fallbackBorder, fallbackShape) else Modifier)
    }

    Box(
        modifier = modifier.then(surfaceModifier),
        contentAlignment = contentAlignment,
        content = content
    )
}

@Composable
fun snowLetterInnerPadding(role: SnowLetterSurfaceRole): PaddingValues =
    if (role == SnowLetterSurfaceRole.AssistantBubble) {
        PaddingValues(horizontal = 13.dp, vertical = 10.dp)
    } else {
        PaddingValues(0.dp)
    }

@Composable
fun snowLetterSheetContainerColor(): Color = MaterialTheme.colorScheme.background

@Composable
fun snowLetterComposerGlyphColor(fallback: Color): Color = fallback

private fun Modifier.optionalShadow(elevation: Dp, shape: Shape): Modifier =
    if (elevation.value > 0f) shadow(elevation, shape, clip = false) else this
