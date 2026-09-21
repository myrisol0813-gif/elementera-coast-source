package com.elementeracoast.app.ui.theme

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex

/**
 * Stable decorative anchor points for Snow Letter sticker assets.
 *
 * Stickers are deliberately kept out of feature/business layout code. A feature
 * only chooses a semantic slot; size, offset, opacity, and stacking live here.
 */
enum class SnowLetterStickerSlot {
    MessageTopRight,
    ComposerTopRight,
    EmptyStateBottomRight,
    FeatureCornerTopRight
}

@Immutable
private data class SnowLetterStickerSpec(
    val alignment: Alignment,
    val offsetX: Dp,
    val offsetY: Dp,
    val size: Dp,
    val alphaMultiplier: Float,
    val zIndex: Float
)

private fun stickerSpec(slot: SnowLetterStickerSlot): SnowLetterStickerSpec = when (slot) {
    SnowLetterStickerSlot.MessageTopRight -> SnowLetterStickerSpec(
        alignment = Alignment.TopEnd,
        offsetX = 8.dp,
        offsetY = (-18).dp,
        size = 54.dp,
        alphaMultiplier = .96f,
        zIndex = 2f
    )
    SnowLetterStickerSlot.ComposerTopRight -> SnowLetterStickerSpec(
        alignment = Alignment.TopEnd,
        offsetX = (-54).dp,
        offsetY = (-24).dp,
        size = 46.dp,
        alphaMultiplier = .90f,
        zIndex = 2f
    )
    SnowLetterStickerSlot.EmptyStateBottomRight -> SnowLetterStickerSpec(
        alignment = Alignment.BottomEnd,
        offsetX = (-14).dp,
        offsetY = (-12).dp,
        size = 76.dp,
        alphaMultiplier = .92f,
        zIndex = 1f
    )
    SnowLetterStickerSlot.FeatureCornerTopRight -> SnowLetterStickerSpec(
        alignment = Alignment.TopEnd,
        offsetX = (-12).dp,
        offsetY = 10.dp,
        size = 62.dp,
        alphaMultiplier = .88f,
        zIndex = 1f
    )
}

/**
 * Places decorative Snow Letter content without changing the surrounding
 * feature geometry or behavior.
 *
 * The anchor is invisible outside the Snow Letter preset. Decoration opacity
 * follows the existing wardrobe decoration slider, so sticker tuning does not
 * need another settings path.
 */
@Composable
fun BoxScope.SnowLetterStickerAnchor(
    slot: SnowLetterStickerSlot,
    modifier: Modifier = Modifier,
    visible: Boolean = true,
    content: @Composable BoxScope.() -> Unit
) {
    val enabled = LocalCoastAppearance.current.preset.usesSnowLetterDecorations()
    if (!enabled || !visible) return

    val spec = stickerSpec(slot)
    val wardrobeAlpha = LocalSnowLetterVisuals.current.decorationAlpha.coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .align(spec.alignment)
            .offset(x = spec.offsetX, y = spec.offsetY)
            .size(spec.size)
            .alpha((wardrobeAlpha * spec.alphaMultiplier).coerceIn(0f, 1f))
            .zIndex(spec.zIndex)
            .clearAndSetSemantics { }
            .then(modifier),
        contentAlignment = Alignment.Center,
        content = content
    )
}
