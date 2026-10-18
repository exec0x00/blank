package com.bibledaily.app.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bibledaily.app.data.Bible
import com.bibledaily.app.data.Book
import com.bibledaily.app.domain.Format
import java.util.BitSet
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class CanonVariant(
    val rows: Float, val rowH: Float, val gap: Float, val labelH: Float, val sectGap: Float, val single: Boolean, val minW: Float,
) {
    Progress(14.5f, 9f, 4f, 15f, 8f, false, 1.1f),
    Done(14.5f, 7f, 4f, 0f, 8f, false, 1.1f),
    Mini(3f, 4f, 4f, 0f, 0f, true, 0.45f),
}

private class Row(val y: Float, val off: Float, val len: Float)
private class Layout(val rows: List<Row>, val height: Float, val wpr: Float, val sectionTitleY: List<Float>, val total: Float, val ntStart: Float)

private const val VW = 300f

private fun layoutFor(v: CanonVariant, total: Int, ntStart: Int): Layout {
    val wpr = total / v.rows
    val rows = ArrayList<Row>()
    val titles = ArrayList<Float>()
    var y = 0f
    val sections = if (v.single) listOf(0f to total.toFloat()) else listOf(0f to ntStart.toFloat(), ntStart.toFloat() to total.toFloat())
    for ((s0, s1) in sections) {
        if (v.labelH > 0) { titles += y + v.labelH - 9f; y += v.labelH }
        val n = ceil((s1 - s0) / wpr - 1e-6f).toInt()
        for (r in 0 until n) {
            val off = s0 + r * wpr
            rows += Row(y, off, min(wpr, s1 - off))
            y += v.rowH + v.gap
        }
        y += v.sectGap
    }
    return Layout(rows, y - v.gap - v.sectGap, wpr, titles, total.toFloat(), ntStart.toFloat())
}

/**
 * The Bible drawn to scale: every book is as wide as it is long, wrapped into rows like lines of text.
 * Each passage read is a gold fleck at its true position.
 */
@Composable
fun CanonMap(
    bible: Bible,
    read: BitSet,
    variant: CanonVariant,
    modifier: Modifier = Modifier,
    today: IntRange? = null,
    interactive: Boolean = false,
    onOpenBook: (Book) -> Unit = {},
    label: String = "",
    revealMs: Int = 1300,
) {
    val p = C.p
    val reduce = LocalReduceMotion.current
    val layout = remember(variant) { layoutFor(variant, bible.totalWords, bible.otWords) }
    val spans = remember(read.cardinality(), read.hashCode()) {
        val out = ArrayList<Float>()
        var v = read.nextSetBit(0)
        while (v >= 0 && v < bible.verseCount) {
            val end = read.nextClearBit(v) - 1
            out += bible.cumWords[v].toFloat(); out += bible.cumWords[end + 1].toFloat()
            v = read.nextSetBit(end + 1)
        }
        out.toFloatArray()
    }
    val todaySpan = today?.let { bible.cumWords[it.first].toFloat() to bible.cumWords[it.last + 1].toFloat() }

    // the gold leaf settles across the map from the first book to the last
    val reveal = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(spans.size) {
        if (reduce) reveal.snapTo(1f) else { reveal.snapTo(0f); reveal.animateTo(1f, tween(revealMs, easing = CubicBezierEasing(0.22f, 0.8f, 0.3f, 1f))) }
    }
    val pulse = rememberInfiniteTransition(label = "pulse")
    val pulseT by pulse.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "p")
    var selected by remember { mutableStateOf<Book?>(null) }
    val selAlpha by animateFloatAsState(if (selected != null) 1f else 0f, motion(160), label = "sel")
    val measurer = rememberTextMeasurer()
    val d = LocalDensity.current

    fun rowAt(yU: Float): Row? = layout.rows.firstOrNull { yU >= it.y - variant.gap / 2 && yU < it.y + variant.rowH + variant.gap / 2 }
    fun bookAtWord(w: Float): Book? = bible.books.firstOrNull { w >= bible.cumWords[it.firstVerse] && w < bible.cumWords[it.lastVerse + 1] }

    var boxW by remember { mutableFloatStateOf(1f) }
    var tipX by remember { mutableFloatStateOf(0f) }
    var tipY by remember { mutableFloatStateOf(0f) }

    Box(modifier.fillMaxWidth()) {
        Canvas(
            Modifier.fillMaxWidth().aspectRatio(VW / layout.height)
                .semantics { contentDescription = label }
                .then(if (!interactive) Modifier else Modifier.pointerInput(Unit) {
                    detectTapGestures { o ->
                        val k = size.width / VW
                        val r = rowAt(o.y / k)
                        val w = r?.let { it.off + (o.x / k) / VW * layout.wpr }
                        val b = if (r != null && w != null && o.x / k <= r.len / layout.wpr * VW) bookAtWord(w) else null
                        if (b != null && b === selected) { onOpenBook(b); selected = null }
                        else { selected = b; if (r != null) { tipX = o.x; tipY = r.y * k } }
                    }
                }),
        ) {
            boxW = size.width
            val k = size.width / VW
            val wpr = layout.wpr
            val rh = variant.rowH * k
            val rad = CornerRadius(rh / 2)
            val rev = reveal.value * layout.total
            val sep = if (variant == CanonVariant.Mini) p.app else p.surface

            for (row in layout.rows) {
                val y = row.y * k
                val w = row.len / wpr * VW * k
                drawRoundRect(p.empty, Offset(0f, y), Size(w, rh), rad)
                val clip = Path().apply { addRoundRect(RoundRect(0f, y, w, y + rh, rad)) }
                clipPath(clip) {
                    var i = 0
                    while (i < spans.size) {
                        val s = max(spans[i], row.off); val e = min(min(spans[i + 1], row.off + row.len), rev)
                        if (e > s) {
                            val x = (s - row.off) / wpr * VW * k
                            drawRect(p.gold, Offset(x, y), Size(max(variant.minW * k, (e - s) / wpr * VW * k), rh))
                        }
                        i += 2
                    }
                    todaySpan?.let { (ts, te) ->
                        val s = max(ts, row.off); val e = min(te, row.off + row.len)
                        if (e > s && variant == CanonVariant.Done && reveal.value > 0.98f) {
                            drawRect(p.gold2, Offset((s - row.off) / wpr * VW * k, y), Size(max(variant.minW * k, (e - s) / wpr * VW * k), rh))
                        }
                    }
                    if (!variant.single) for (b in bible.books) {
                        val bs = bible.cumWords[b.firstVerse].toFloat()
                        if (b.index > 1 && b.index != 40 && bs >= row.off && bs < row.off + row.len) {
                            val x = (bs - row.off) / wpr * VW * k
                            drawLine(sep, Offset(x, y - 1), Offset(x, y + rh + 1), strokeWidth = 1.2f * k)
                        }
                    }
                }
            }
            // section titles
            if (!variant.single && variant.labelH > 0) {
                listOf("OLD TESTAMENT", "NEW TESTAMENT").forEachIndexed { i, t ->
                    val ty = layout.sectionTitleY.getOrNull(i) ?: return@forEachIndexed
                    val tl = measurer.measure(t, sans(6.4f * k / d.density * 1f, 600, tracking = 0.6f).copy(color = p.ink3))
                    drawText(tl, topLeft = Offset(0f, ty * k - tl.size.height + 2f))
                }
            }
            // the marker: Today's passage (mini) or a pulsing ring (done)
            todaySpan?.let { (ts, te) ->
                val row = layout.rows.firstOrNull { ts >= it.off && ts < it.off + it.len } ?: layout.rows.last()
                val x = ((ts - row.off) / wpr * VW + max(1f, (min(te, row.off + row.len) - ts) / wpr * VW) / 2) * k
                val cy = (row.y + variant.rowH / 2) * k
                when (variant) {
                    CanonVariant.Mini -> drawRoundRect(p.ink, Offset((ts - row.off) / wpr * VW * k - 0.6f * k, row.y * k - 3f * k), Size(1.6f * k, rh + 6f * k), CornerRadius(0.8f * k))
                    CanonVariant.Done -> {
                        val r0 = rh * 1.05f
                        drawCircle(p.gold2, r0, Offset(x, cy), style = Stroke(1.2f * k))
                        if (!reduce) {
                            val sc = 0.8f + pulseT * 1.0f
                            drawCircle(p.gold2.copy(alpha = (1f - pulseT).coerceIn(0f, 1f) * 0.9f), r0 * sc, Offset(x, cy), style = Stroke(1.2f * k))
                        }
                    }
                    else -> {}
                }
            }
            // tapped book outline
            selected?.let { b ->
                val bs = bible.cumWords[b.firstVerse].toFloat(); val be = bible.cumWords[b.lastVerse + 1].toFloat()
                for (row in layout.rows) {
                    val s = max(bs, row.off); val e = min(be, row.off + row.len)
                    if (e > s) drawRoundRect(p.ink.copy(alpha = selAlpha), Offset((s - row.off) / wpr * VW * k, row.y * k),
                        Size(max(2f, (e - s) / wpr * VW * k), rh), rad, style = Stroke(1.dp.toPx()))
                }
            }
        }

        // tooltip
        val b = selected
        androidx.compose.animation.AnimatedVisibility(
            b != null, Modifier.align(Alignment.TopStart),
            enter = androidx.compose.animation.fadeIn(motion(140)) + androidx.compose.animation.scaleIn(springy(0.7f, 500f), initialScale = 0.85f),
            exit = androidx.compose.animation.fadeOut(motion(120)),
        ) {
            var lastBook by remember { mutableStateOf(b) }
            if (b != null) lastBook = b
            val bk = lastBook
            if (bk != null) {
                val per = remember(read.cardinality(), bk) { val wr = bible.wordsBetween(bk.firstVerse, bk.lastVerse).let { 0 }; wr }
                var readWords = 0
                var v = read.nextSetBit(bk.firstVerse)
                while (v in 0..bk.lastVerse) { readWords += bible.words[v]; v = read.nextSetBit(v + 1) }
                Column(
                    Modifier.offset { IntOffset((tipX - 70.dp.toPx()).coerceIn(0f, max(0f, boxW - 150.dp.toPx())).roundToInt(), (tipY - 52.dp.toPx()).coerceAtLeast(0f).roundToInt()) }
                        .clip(RoundedCornerShape(10.dp)).background(p.ink).padding(10.dp, 8.dp),
                ) {
                    Text(bk.name, style = sans(12f, 600), color = p.app)
                    Text("${Format.progressPercent(readWords, bk.words)}% read · ${Format.number(bk.words)} words", style = sans(11.5f), color = p.app.copy(alpha = 0.85f))
                    Text("Tap again to open", style = sans(10.5f), color = p.app.copy(alpha = 0.55f))
                }
            }
        }
    }
}
