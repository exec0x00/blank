package com.bibledaily.app.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale as dsScale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

// ------------------------------------------------------------------ haptics

class Haptics(private val fb: androidx.compose.ui.hapticfeedback.HapticFeedback) {
    fun tick() = fb.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    fun press() = fb.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    fun confirm() = fb.performHapticFeedback(HapticFeedbackType.LongPress)
}

@Composable
fun rememberHaptics(): Haptics {
    val fb = LocalHapticFeedback.current
    return remember(fb) { Haptics(fb) }
}

// ------------------------------------------------------------------ press feedback

/** Springs the element down a little while it is pressed. Used on every tappable thing. */
fun Modifier.pressable(
    enabled: Boolean = true,
    pressedScale: Float = 0.965f,
    haptic: Boolean = true,
    role: Role? = Role.Button,
    onClick: () -> Unit,
): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val reduce = LocalReduceMotion.current
    val s by animateFloatAsState(
        if (pressed && enabled && !reduce) pressedScale else 1f,
        spring(dampingRatio = 0.55f, stiffness = 520f), label = "press",
    )
    val h = rememberHaptics()
    this
        .scale(s)
        .clickable(source, indication = null, enabled = enabled, role = role) {
            if (haptic) h.press()
            onClick()
        }
}

/** Fades and rises in once, after [delayMs]. Gives screens a staggered entrance. */
fun Modifier.appear(delayMs: Int = 0, rise: Dp = 14.dp, key: Any? = Unit): Modifier = composed {
    val reduce = LocalReduceMotion.current
    val t = remember(key) { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(key) { if (!reduce) { delay(delayMs.toLong()); t.animateTo(1f, tween(520, easing = EaseOutExpo)) } }
    val px = with(LocalDensity.current) { rise.toPx() }
    this.graphicsLayer { alpha = t.value; translationY = (1f - t.value) * px }
}

// ------------------------------------------------------------------ icons

object Ic {
    const val BACK = "M15 5l-7 7 7 7"
    const val CHEVRON = "M9 5l7 7-7 7"
    const val CHECK = "M5 12.5l4.5 4.5L19 7.5"
    const val TODAY = "M3.5 5.5c2.5-1 5.4-.9 7.5.6 2.1-1.5 5-1.6 7.5-.6V19c-2.5-1-5.4-.9-7.5.6-2.1-1.5-5-1.6-7.5-.6z M11 6.1v13.4"
    const val PROGRESS = "M4 7h16M4 12h16M4 17h10 M8 5.5v3M15 10.5v3M7 15.5v3"
    const val SETTINGS = "M4 7h9M17 7h3M4 17h3M11 17h9"
    const val UPLOAD = "M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"
    const val DOWNLOAD = "M12 3v12M7 10l5 5 5-5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"
    const val FILE = "M6 2.8h8l4.5 4.5v13.9H6z M14 2.8v4.5h4.5"
    const val SHARE = "M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"
    const val COPY = "M9 9h10v11H9z M5 15V4h10"
    const val SWAP = "M4 8h13l-3-3M20 16H7l3 3"
    const val BOOK = "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z M5 17a3 3 0 013-3h11"
    const val TEXT = "M4 19L10 5l6 14M6.5 14h7 M17 12h4M19 10v4"
    const val CLOSE = "M6 6l12 12M18 6L6 18"
}

private val pathCache = HashMap<String, Path>()
private fun pathOf(d: String): Path = pathCache.getOrPut(d) { PathParser().parsePathString(d).toPath() }

@Composable
fun PathIcon(d: String, size: Dp = 21.dp, color: Color = C.p.ink, stroke: Float = 1.7f, progress: Float = 1f, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val k = this.size.minDimension / 24f
        dsScale(k, k, pivot = Offset.Zero) {
            val path = pathOf(d)
            if (progress >= 1f) {
                drawPath(path, color, style = Stroke(stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
            } else {
                val pm = PathMeasure().also { it.setPath(path, false) }
                val dst = Path()
                pm.getSegment(0f, pm.length * progress, dst, true)
                drawPath(dst, color, style = Stroke(stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
    }
}

// ------------------------------------------------------------------ buttons

enum class BtnKind { Ink, Ghost, Link }

@Composable
fun AppButton(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier, kind: BtnKind = BtnKind.Ink,
    enabled: Boolean = true, leading: (@Composable () -> Unit)? = null,
) {
    val p = C.p
    val (bg, fg) = when (kind) {
        BtnKind.Ink -> p.btn to p.btnInk
        BtnKind.Ghost -> Color.Transparent to p.ink
        BtnKind.Link -> Color.Transparent to p.ink2
    }
    Row(
        modifier.fillMaxWidth().height(if (kind == BtnKind.Link) 40.dp else 50.dp)
            .pressable(enabled, onClick = onClick)
            .clip(RoundedCornerShape(16.dp)).background(bg)
            .then(if (kind == BtnKind.Ghost) Modifier.border(1.dp, p.hair2, RoundedCornerShape(16.dp)) else Modifier)
            .alpha(if (enabled) 1f else 0.4f).padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(8.dp)) }
        Text(text, style = sans(14.5f, if (kind == BtnKind.Link) 500 else 600), color = fg)
    }
}

@Composable
fun Text(text: String, modifier: Modifier = Modifier, style: TextStyle = sans(14f), color: Color = C.p.ink,
         maxLines: Int = Int.MAX_VALUE, textAlign: TextAlign? = null) {
    androidx.compose.foundation.text.BasicText(
        text, modifier, style = style.copy(color = color, textAlign = textAlign ?: TextAlign.Unspecified),
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) androidx.compose.ui.text.style.TextOverflow.Clip else androidx.compose.ui.text.style.TextOverflow.Ellipsis,
    )
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(), modifier, eyebrowStyle(), C.p.ink3)

@Composable
fun Rule(modifier: Modifier = Modifier, vertical: Dp = 26.dp) =
    Box(modifier.fillMaxWidth().padding(vertical = vertical).height(1.dp).background(C.p.hair))

// ------------------------------------------------------------------ switch

@Composable
fun GoldSwitch(checked: Boolean, onChange: (Boolean) -> Unit, label: String) {
    val p = C.p
    val h = rememberHaptics()
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val x by animateDpAsState(if (checked) 17.dp else 0.dp, springy(0.6f, 520f), label = "x")
    val thumbW by animateDpAsState(if (pressed) 25.dp else 20.dp, springy(0.7f, 600f), label = "w")
    val shift by animateDpAsState(if (pressed && checked) (-5).dp else 0.dp, springy(0.7f, 600f), label = "s")
    val bg by animateColorAsState(if (checked) p.ink else p.hair2, motion(220), label = "bg")
    Box(
        Modifier.size(42.dp, 25.dp).clip(RoundedCornerShape(13.dp)).background(bg)
            .semantics { contentDescription = label; role = Role.Switch; toggleableState = androidx.compose.ui.state.ToggleableState(checked) }
            .clickable(source, null) { h.tick(); onChange(!checked) },
    ) {
        Box(
            Modifier.offset(x = 2.5.dp + x + shift, y = 2.5.dp).size(thumbW, 20.dp)
                .shadow(2.dp, CircleShape).clip(RoundedCornerShape(10.dp))
                .background(if (checked) p.app else Color.White),
        )
    }
}

// ------------------------------------------------------------------ slider

@Composable
fun GoldSlider(
    value: Int, min: Int, max: Int, step: Int, onChange: (Int) -> Unit, onFinished: () -> Unit, description: String,
) {
    val p = C.p
    val h = rememberHaptics()
    var dragging by remember { mutableStateOf(false) }
    val thumb by animateFloatAsState(if (dragging) 1.18f else 1f, springy(0.6f, 500f), label = "thumb")
    val halo by animateFloatAsState(if (dragging) 1f else 0f, motion(180), label = "halo")
    var widthPx by remember { mutableFloatStateOf(1f) }
    val frac = (value - min).toFloat() / (max - min)
    val thumbR = with(LocalDensity.current) { 13.dp.toPx() }
    fun fromX(x: Float): Int {
        val f = ((x - thumbR) / (widthPx - 2 * thumbR)).coerceIn(0f, 1f)
        val raw = min + f * (max - min)
        return (min + ((raw - min) / step).roundToInt() * step).coerceIn(min, max)
    }
    var last by remember { mutableIntStateOf(value) }
    Box(
        Modifier.fillMaxWidth().height(32.dp)
            .semantics {
                contentDescription = description
                progressBarRangeInfo = ProgressBarRangeInfo(value.toFloat(), min.toFloat()..max.toFloat())
                setProgress { t -> onChange(((t.roundToInt() - min) / step * step + min).coerceIn(min, max)); true }
            }
            .pointerInput(Unit) {
                detectTapGestures { o -> val v = fromX(o.x); if (v != last) { last = v; h.tick(); onChange(v) }; onFinished() }
            }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { o -> dragging = true; val v = fromX(o.x); if (v != last) { last = v; onChange(v) } },
                    onDragEnd = { dragging = false; onFinished() },
                    onDragCancel = { dragging = false; onFinished() },
                ) { change, _ ->
                    change.consume()
                    val v = fromX(change.position.x)
                    if (v != last) { last = v; h.tick(); onChange(v) }
                }
            },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            widthPx = size.width
            val cy = size.height / 2
            val x0 = thumbR; val x1 = size.width - thumbR
            val tx = x0 + (x1 - x0) * frac
            drawRoundRect(p.empty, Offset(x0, cy - 1.5.dp.toPx()), Size(x1 - x0, 3.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(2f))
            drawRoundRect(p.gold, Offset(x0, cy - 1.5.dp.toPx()), Size(tx - x0, 3.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(2f))
            drawCircle(p.gold.copy(alpha = 0.16f * halo), thumbR * 1.9f, Offset(tx, cy))
            drawCircle(Color.Black.copy(alpha = 0.16f), thumbR * thumb + 1.5.dp.toPx(), Offset(tx, cy + 2.dp.toPx()))
            drawCircle(Color.White, thumbR * thumb, Offset(tx, cy))
            drawCircle(Color.Black.copy(alpha = 0.10f), thumbR * thumb, Offset(tx, cy), style = Stroke(0.6.dp.toPx()))
        }
    }
}

// ------------------------------------------------------------------ segmented control

@Composable
fun Segmented(options: List<Pair<String, String?>>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val p = C.p
    val h = rememberHaptics()
    var w by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val segW = with(density) { (w / options.size).toDp() }
    val x by animateDpAsState(segW * selected.coerceAtLeast(0), springy(0.75f, 420f), label = "seg")
    val pillAlpha by animateFloatAsState(if (selected >= 0) 1f else 0f, motion(160), label = "pa")
    Box(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.app)
            .border(1.dp, p.hair, RoundedCornerShape(12.dp)).padding(3.dp)
            .onSizeChanged { w = it.width - with(density) { 6.dp.roundToPx() } },
    ) {
        Box(
            Modifier.offset(x = x).width(segW).height(44.dp).alpha(pillAlpha).shadow(1.dp, RoundedCornerShape(9.dp))
                .clip(RoundedCornerShape(9.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(9.dp)),
        )
        Row {
            options.forEachIndexed { i, (title, sub) ->
                Column(
                    Modifier.weight(1f).height(44.dp).pressable(pressedScale = 0.95f, role = Role.RadioButton) { h.tick(); onSelect(i) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    Text(title, style = sans(12f, 600), color = if (i == selected) p.ink else p.ink2)
                    if (sub != null) Text(sub, style = sans(11.5f), color = p.ink3)
                }
            }
        }
    }
}

private fun Modifier.onSizeChanged(f: (androidx.compose.ui.unit.IntSize) -> Unit) =
    this.then(Modifier.onGloballyPositioned { f(it.size) })

// ------------------------------------------------------------------ numbers that roll

/** A number that counts up to its value when it appears or changes. */
@Composable
fun CountText(
    value: Float, style: TextStyle, modifier: Modifier = Modifier, color: Color = C.p.ink,
    durationMs: Int = 900, from: Float = 0f, format: (Float) -> String,
) {
    val reduce = LocalReduceMotion.current
    val shown = remember { Animatable(if (reduce) value else from) }
    LaunchedEffect(value) { shown.animateTo(value, if (reduce) snap() else tween(durationMs, easing = EaseOutExpo)) }
    Text(format(shown.value), modifier, style, color)
}

/** Digits that slide up or down when the number changes (used by the length slider). */
@Composable
fun RollingText(text: String, style: TextStyle, modifier: Modifier = Modifier, color: Color = C.p.ink, up: Boolean) {
    AnimatedContent(
        text, modifier,
        transitionSpec = {
            val d = if (up) 1 else -1
            (slideInVertically(tween(180)) { d * it / 2 } + fadeIn(tween(160))) togetherWith
                (slideOutVertically(tween(180)) { -d * it / 2 } + fadeOut(tween(120)))
        }, label = "roll",
    ) { t -> Text(t, style = style, color = color) }
}

// ------------------------------------------------------------------ sheet and toast

@Composable
fun BottomSheet(visible: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val p = C.p
    Box(Modifier.fillMaxSize().zIndex(20f)) {
        AnimatedVisibility(visible, enter = fadeIn(motion(240)), exit = fadeOut(motion(200))) {
            Box(Modifier.fillMaxSize().background(Color(0x61_0A0B0D)).pointerInput(Unit) { detectTapGestures { onDismiss() } })
        }
        AnimatedVisibility(
            visible, Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically(springy(0.86f, 360f)) { it } + fadeIn(motion(120)),
            exit = slideOutVertically(motion(240, FastOutLinearInEasing)) { it } + fadeOut(motion(200)),
        ) {
            Column(
                Modifier.padding(8.dp).navigationBarsPadding().fillMaxWidth()
                    .clip(RoundedCornerShape(34.dp)).background(p.app)
                    .pointerInput(Unit) { detectTapGestures { } }
                    .padding(start = 18.dp, end = 18.dp, top = 10.dp, bottom = 14.dp),
            ) {
                Box(Modifier.align(Alignment.CenterHorizontally).size(36.dp, 4.dp).clip(RoundedCornerShape(2.dp)).background(p.hair2))
                Spacer(Modifier.height(18.dp))
                content()
            }
        }
    }
}

@Composable
fun Toast(title: String?, detail: String?, modifier: Modifier = Modifier) {
    val p = C.p
    var last by remember { mutableStateOf(title to detail) }
    if (title != null) last = title to detail
    AnimatedVisibility(
        title != null, modifier.zIndex(30f),
        enter = slideInVertically(springy(0.7f, 420f)) { it / 2 } + fadeIn(motion(160)),
        exit = slideOutVertically(motion(220)) { it / 2 } + fadeOut(motion(180)),
    ) {
        Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.ink).padding(14.dp, 12.dp)) {
            Text(last.first ?: "", style = sans(12.5f, 600), color = p.app)
            last.second?.let { Text(it, style = sans(11.5f), color = p.app.copy(alpha = 0.8f)) }
        }
    }
}

/** A circular icon button used in the reader's top bar. */
@Composable
fun CircleButton(path: String, label: String, onClick: () -> Unit) {
    val p = C.p
    Box(
        Modifier.size(38.dp).pressable(pressedScale = 0.88f, onClick = onClick)
            .semantics { contentDescription = label }
            .clip(CircleShape).background(p.surface).border(1.dp, p.hair, CircleShape),
        contentAlignment = Alignment.Center,
    ) { PathIcon(path, 17.dp, p.ink, 2.1f) }
}

/** The small gold diamond that ends a reading. */
@Composable
fun Diamond(modifier: Modifier = Modifier) {
    val p = C.p
    Box(modifier.size(6.dp).graphicsLayer { rotationZ = 45f }.background(p.gold))
}
