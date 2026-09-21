package com.elementeracoast.app.ui.brand

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/** Exact timing contract migrated from the PWA Gate CSS in functions/auth.js. */
object CoastGateMotionSpec {
    const val LoopDurationMs = 720
    const val LoopAStartMs = 50
    const val LoopBStartMs = 160
    const val LoopCStartMs = 270
    const val PrimaryMarkStartMs = 620
    const val PrimaryMarkDurationMs = 400
    const val SecondaryMarkStartMs = 760
    const val SecondaryMarkDurationMs = 450
    const val SettleStartMs = 980
    const val SettleDurationMs = 500
    const val BrandStartMs = 1020
    const val TaglineStartMs = 1140
    const val TextDurationMs = 400
    const val GateFormStartMs = 1380
    const val GateFormDurationMs = 400
    const val TotalDurationMs = 1780
}

data class CoastGateMotion(
    val loopA: Float,
    val loopB: Float,
    val loopC: Float,
    val primaryMark: Float,
    val secondaryMark: Float,
    val markScale: Float,
    val brand: Float,
    val tagline: Float,
    val form: Float
)

private val LoopEasing = CubicBezierEasing(.3f, .75f, .25f, 1f)
private val PrimaryMarkEasing = CubicBezierEasing(.2f, .9f, .3f, 1.25f)
private val SecondaryMarkEasing = CubicBezierEasing(.2f, .85f, .25f, 1.15f)
private val CssEaseOut = CubicBezierEasing(0f, 0f, .58f, 1f)

private fun segment(
    elapsed: Float,
    start: Int,
    duration: Int,
    easing: CubicBezierEasing
): Float {
    val raw = ((elapsed - start) / duration.toFloat()).coerceIn(0f, 1f)
    return easing.transform(raw)
}

private fun settleScale(elapsed: Float): Float {
    val raw = ((elapsed - CoastGateMotionSpec.SettleStartMs) / CoastGateMotionSpec.SettleDurationMs.toFloat())
        .coerceIn(0f, 1f)
    return if (raw <= .5f) {
        1f + .012f * (raw / .5f)
    } else {
        1.012f - .012f * ((raw - .5f) / .5f)
    }
}

@Composable
fun rememberCoastGateMotion(): CoastGateMotion {
    val clock = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        clock.animateTo(
            targetValue = CoastGateMotionSpec.TotalDurationMs.toFloat(),
            animationSpec = tween(
                durationMillis = CoastGateMotionSpec.TotalDurationMs,
                easing = LinearEasing
            )
        )
    }
    val elapsed by clock.asState()
    return CoastGateMotion(
        loopA = segment(elapsed, CoastGateMotionSpec.LoopAStartMs, CoastGateMotionSpec.LoopDurationMs, LoopEasing),
        loopB = segment(elapsed, CoastGateMotionSpec.LoopBStartMs, CoastGateMotionSpec.LoopDurationMs, LoopEasing),
        loopC = segment(elapsed, CoastGateMotionSpec.LoopCStartMs, CoastGateMotionSpec.LoopDurationMs, LoopEasing),
        primaryMark = segment(elapsed, CoastGateMotionSpec.PrimaryMarkStartMs, CoastGateMotionSpec.PrimaryMarkDurationMs, PrimaryMarkEasing),
        secondaryMark = segment(elapsed, CoastGateMotionSpec.SecondaryMarkStartMs, CoastGateMotionSpec.SecondaryMarkDurationMs, SecondaryMarkEasing),
        markScale = settleScale(elapsed),
        brand = segment(elapsed, CoastGateMotionSpec.BrandStartMs, CoastGateMotionSpec.TextDurationMs, CssEaseOut),
        tagline = segment(elapsed, CoastGateMotionSpec.TaglineStartMs, CoastGateMotionSpec.TextDurationMs, CssEaseOut),
        form = segment(elapsed, CoastGateMotionSpec.GateFormStartMs, CoastGateMotionSpec.GateFormDurationMs, CssEaseOut)
    )
}

@Composable
fun CoastBrandMarkAnimation(
    motion: CoastGateMotion,
    modifier: Modifier = Modifier,
    separatorColor: Color = CoastPaper
) {
    CoastBrandMark(
        modifier = modifier,
        separatorColor = separatorColor,
        loopAProgress = motion.loopA,
        loopBProgress = motion.loopB,
        loopCProgress = motion.loopC,
        primaryMarkProgress = motion.primaryMark,
        secondaryMarkProgress = motion.secondaryMark,
        markScale = motion.markScale
    )
}
