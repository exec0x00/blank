package com.bibledaily.app.ui

import android.provider.Settings as AndroidSettings
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.unit.sp
import com.bibledaily.app.R
import com.bibledaily.app.data.ThemeMode

/** Colour tokens from the mockup. Gold appears only for progress. */
@Immutable
class Palette(
    val app: Color, val panel: Color, val surface: Color, val ink: Color, val ink2: Color, val ink3: Color,
    val hair: Color, val hair2: Color, val gold: Color, val gold2: Color, val goldInk: Color, val goldWash: Color,
    val empty: Color, val btn: Color, val btnInk: Color, val danger: Color, val dark: Boolean,
)

val LightPalette = Palette(
    app = Color(0xFFFAFAF7), panel = Color(0xFFF6F6F3), surface = Color(0xFFFFFFFF), ink = Color(0xFF14161A),
    ink2 = Color(0xFF565B63), ink3 = Color(0xFF8D9199), hair = Color(0xFFE4E4DF), hair2 = Color(0xFFD5D5CF),
    gold = Color(0xFFA67A2A), gold2 = Color(0xFFC79B45), goldInk = Color(0xFF87601A), goldWash = Color(0xFFF4EEE1),
    empty = Color(0xFFEBEAE4), btn = Color(0xFF14161A), btnInk = Color(0xFFFAFAF7), danger = Color(0xFFA8402E), dark = false,
)
val DarkPalette = Palette(
    app = Color(0xFF0F1013), panel = Color(0xFF111215), surface = Color(0xFF17181C), ink = Color(0xFFF1EEE7),
    ink2 = Color(0xFFA6AAB2), ink3 = Color(0xFF6E737C), hair = Color(0xFF222429), hair2 = Color(0xFF2D2F35),
    gold = Color(0xFFCDA45A), gold2 = Color(0xFFE2BE76), goldInk = Color(0xFFDDB66C), goldWash = Color(0xFF26211A),
    empty = Color(0xFF1D1E23), btn = Color(0xFFF1EEE7), btnInk = Color(0xFF0F1013), danger = Color(0xFFE08A78), dark = true,
)

val LocalPalette = staticCompositionLocalOf { LightPalette }
val LocalReduceMotion = staticCompositionLocalOf { false }
val LocalTextScale = staticCompositionLocalOf { 1f }

object C {
    val p: Palette @Composable get() = LocalPalette.current
}

/** Cross-fades between palettes when the theme changes. */
@Composable
fun animated(p: Palette): Palette {
    val spec = tween<Color>(if (LocalReduceMotion.current) 0 else 320)
    @Composable fun a(c: Color) = animateColorAsState(c, spec, label = "c").value
    return Palette(a(p.app), a(p.panel), a(p.surface), a(p.ink), a(p.ink2), a(p.ink3), a(p.hair), a(p.hair2),
        a(p.gold), a(p.gold2), a(p.goldInk), a(p.goldWash), a(p.empty), a(p.btn), a(p.btnInk), a(p.danger), p.dark)
}

@Composable
fun BibleTheme(mode: ThemeMode, textScale: Float, content: @Composable () -> Unit) {
    val dark = when (mode) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; ThemeMode.DARK -> true }
    val ctx = LocalContext.current
    val reduce = remember {
        runCatching { AndroidSettings.Global.getFloat(ctx.contentResolver, AndroidSettings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
            .getOrDefault(false)
    }
    CompositionLocalProvider(
        LocalPalette provides animated(if (dark) DarkPalette else LightPalette),
        LocalReduceMotion provides reduce,
        LocalTextScale provides textScale,
        content = content,
    )
}

// ------------------------------------------------------------------ type

@OptIn(ExperimentalTextApi::class)
private fun serifFont(weight: Int, opsz: Float, italic: Boolean): FontFamily = FontFamily(
    Font(
        if (italic) R.font.newsreader_italic_var else R.font.newsreader_var,
        weight = FontWeight(weight),
        style = if (italic) FontStyle.Italic else FontStyle.Normal,
        variationSettings = FontVariation.Settings(FontVariation.weight(weight), FontVariation.Setting("opsz", opsz)),
    )
)

@OptIn(ExperimentalTextApi::class)
private fun sansFont(weight: Int): FontFamily = FontFamily(
    Font(R.font.instrument_sans_var, weight = FontWeight(weight),
        variationSettings = FontVariation.Settings(FontVariation.weight(weight), FontVariation.Setting("wdth", 100f)))
)

private val serifCache = HashMap<Triple<Int, Int, Boolean>, FontFamily>()
private val sansCache = HashMap<Int, FontFamily>()

/** Newsreader at a given weight and optical size (larger opsz for headings). */
fun serif(size: Float, weight: Int = 300, opsz: Float = size.coerceIn(6f, 72f), italic: Boolean = false,
          line: Float = 1.2f, tracking: Float = 0f) = TextStyle(
    fontFamily = serifCache.getOrPut(Triple(weight, opsz.toInt(), italic)) { serifFont(weight, opsz, italic) },
    fontSize = size.sp, fontWeight = FontWeight(weight), fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    lineHeight = (size * line).sp, letterSpacing = (tracking * size).sp,
)

/** Instrument Sans for interface labels. */
fun sans(size: Float, weight: Int = 400, line: Float = 1.35f, tracking: Float = 0f) = TextStyle(
    fontFamily = sansCache.getOrPut(weight) { sansFont(weight) },
    fontSize = size.sp, fontWeight = FontWeight(weight), lineHeight = (size * line).sp, letterSpacing = tracking.sp,
)

fun eyebrowStyle() = sans(10.5f, 600, tracking = 0.95f)

/** Animation spec helpers that respect the system's "remove animations" setting. */
@Composable
fun <T> motion(ms: Int = 320, easing: Easing = FastOutSlowInEasing): FiniteAnimationSpec<T> =
    if (LocalReduceMotion.current) snap() else tween(ms, easing = easing)

@Composable
fun <T> springy(damping: Float = 0.62f, stiffness: Float = 420f): FiniteAnimationSpec<T> =
    if (LocalReduceMotion.current) snap() else spring(damping, stiffness)

val EaseOutExpo = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
