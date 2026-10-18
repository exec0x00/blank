package com.bibledaily.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.bibledaily.app.*
import com.bibledaily.app.domain.*
import kotlinx.coroutines.delay
import java.time.LocalDate

/** A thin track whose gold fill grows in when it appears. */
@Composable
fun GrowBar(fraction: Float, modifier: Modifier = Modifier, delayMs: Int = 0, height: Int = 3) {
    val p = C.p
    val reduce = LocalReduceMotion.current
    val f = remember { Animatable(if (reduce) fraction else 0f) }
    LaunchedEffect(fraction) { delay(delayMs.toLong()); f.animateTo(fraction, if (reduce) snap() else tween(900, easing = EaseOutExpo)) }
    Box(modifier.fillMaxWidth().height(height.dp).clip(RoundedCornerShape(2.dp)).background(p.empty)) {
        Box(Modifier.fillMaxWidth(f.value.coerceIn(0f, 1f)).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(p.gold))
    }
}

@Composable
fun ProgressScreen(vm: AppViewModel, l: Loaded) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val today = l.ctrl.clock.today()
    val stats = remember(st.read.cardinality(), st.history.size, st.settings.dailyWords) { Stats.compute(l.bible, st, today) }
    val active = st.today?.takeIf { it.status == com.bibledaily.app.data.ReadingStatus.ACTIVE }
    var n = 0
    fun d() = (n++) * 50
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 24.dp, bottom = 120.dp)) {
        Text("Progress", Modifier.appear(d()).semantics { heading() }, serif(32f, 300, 60f, line = 1.05f, tracking = -0.015f))
        Spacer(Modifier.height(22.dp))
        Row(Modifier.appear(d()), verticalAlignment = Alignment.Top) {
            CountText(stats.fraction * 100f, serif(84f, 200, 72f, line = 0.9f, tracking = -0.035f), durationMs = 1400,
                format = { Format.progressPercent((it * 1000).toInt(), 100_000).let { s -> s } })
            Text("%", Modifier.padding(start = 2.dp, top = 10.dp), serif(28f, 300, 28f), p.ink3)
        }
        Text("of the Bible read · ${Format.number(stats.wordsRead)} of ${Format.number(stats.totalWords)} words", Modifier.padding(top = 10.dp, bottom = 26.dp).appear(d()), sans(12.5f), p.ink3)
        Column(Modifier.fillMaxWidth().appear(d()).clip(RoundedCornerShape(20.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(20.dp)).padding(14.dp, 16.dp, 14.dp, 14.dp)) {
            CanonMap(l.bible, st.read, CanonVariant.Progress, today = active?.let { it.firstVerse..it.lastVerse }, interactive = true,
                onOpenBook = { vm.push(Route.BookDetail(it.index)) },
                label = "Canon map: ${Format.progressPercent(stats.wordsRead, stats.totalWords)} percent of the Bible read. Closest to finished: " +
                    stats.closest.joinToString(", ") { "${l.bible.books[it.bookIndex - 1].name} ${(it.fraction * 100).toInt()} percent" })
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Widths match book length", style = sans(10.5f), color = p.ink3)
                Text("Tap a book", style = sans(10.5f), color = p.ink3)
            }
        }
        Column(Modifier.padding(top = 26.dp).appear(d()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            TestamentRow("Old Testament", stats.otRead, l.bible.otWords)
            TestamentRow("New Testament", stats.ntRead, l.bible.ntWords)
        }
        Column(Modifier.padding(top = 26.dp).fillMaxWidth().appear(d())) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(p.hair))
            StatRow("${Format.number(stats.readings)}", "readings", "${Format.number(stats.chaptersStarted)}", "of 1,189 chapters started")
            StatRow("${stats.streak} ${if (stats.streak == 1) "day" else "days"}", "current streak", "${stats.longestStreak} ${if (stats.longestStreak == 1) "day" else "days"}", "longest streak")
            Column(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
                Text(stats.finishText, style = serif(26f, 300, 48f, line = 1.1f, tracking = -0.01f))
                Text("to finish at ${Format.number(st.settings.dailyWords)} words a day", style = sans(11f), color = p.ink3)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(p.hair))
        }
        if (stats.closest.isNotEmpty()) {
            Eyebrow("Closest to finished", Modifier.padding(top = 30.dp).appear(d()))
            Column(Modifier.padding(top = 8.dp).appear(d())) {
                stats.closest.forEachIndexed { i, b -> BookRow(l, b, i * 80) { vm.push(Route.BookDetail(b.bookIndex)) } }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 14.dp).pressable(role = null) { vm.push(Route.AllBooks) }, verticalAlignment = Alignment.CenterVertically) {
            Text("All 66 books", style = sans(12.5f, 600)); Spacer(Modifier.width(6.dp)); PathIcon(Ic.CHEVRON, 13.dp, p.ink, 2f)
        }
    }
}

@Composable
private fun TestamentRow(label: String, read: Int, total: Int) {
    val p = C.p
    Column {
        Row(Modifier.fillMaxWidth().padding(bottom = 7.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = sans(12f), color = p.ink2)
            Text(Format.progressPercent(read, total) + "%", style = sans(12f, 600))
        }
        GrowBar(read.toFloat() / total, delayMs = 200)
    }
}

@Composable
private fun StatRow(a: String, aLabel: String, b: String, bLabel: String) {
    val p = C.p
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Column(Modifier.weight(1f).padding(vertical = 14.dp).padding(end = 12.dp)) {
            Text(a, style = serif(26f, 300, 48f, line = 1.1f, tracking = -0.01f)); Text(aLabel, style = sans(11f), color = p.ink3)
        }
        Box(Modifier.fillMaxHeight().width(1.dp).background(p.hair))
        Column(Modifier.weight(1f).padding(vertical = 14.dp).padding(start = 14.dp)) {
            Text(b, style = serif(26f, 300, 48f, line = 1.1f, tracking = -0.01f)); Text(bLabel, style = sans(11f), color = p.ink3)
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(p.hair))
}

@Composable
private fun BookRow(l: Loaded, b: BookProgress, delayMs: Int, onClick: () -> Unit) {
    val p = C.p
    val book = l.bible.books[b.bookIndex - 1]
    Row(Modifier.fillMaxWidth().pressable(pressedScale = 0.985f, role = null, onClick = onClick).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(book.name, Modifier.width(112.dp), sans(12.5f), maxLines = 1)
        Box(Modifier.weight(1f).padding(horizontal = 12.dp)) { GrowBar(b.fraction, delayMs = delayMs) }
        Text("${Math.round(b.fraction * 100)}%", Modifier.width(38.dp), sans(11.5f, 600), textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(p.hair))
}

@Composable
fun AllBooksScreen(vm: AppViewModel, l: Loaded) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val per = remember(st.read.cardinality()) { Stats.perBook(l.bible, st.read) }
    BackHandler { vm.pop() }
    Box(Modifier.fillMaxSize().background(p.app)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 64.dp, bottom = 120.dp)) {
            Text("All books", Modifier.semantics { heading() }, serif(32f, 300, 60f, line = 1.05f, tracking = -0.015f))
            Spacer(Modifier.height(10.dp))
            l.bible.books.forEachIndexed { i, b ->
                if (i == 0 || i == 39) Eyebrow(if (i == 0) "Old Testament" else "New Testament", Modifier.padding(top = if (i == 0) 12.dp else 28.dp, bottom = 4.dp))
                BookRow(l, BookProgress(b.index, per[i], b.words), (i % 12) * 30) { vm.push(Route.BookDetail(b.index)) }
            }
        }
        Box(Modifier.statusBarsPadding().padding(16.dp, 6.dp)) { CircleButton(Ic.BACK, "Back") { vm.pop() } }
    }
}

@Composable
fun BookDetailScreen(vm: AppViewModel, l: Loaded, bookIndex: Int) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val book = l.bible.books[bookIndex - 1]
    BackHandler { vm.pop() }
    val chapterRead = remember(st.read.cardinality(), bookIndex) {
        (0 until book.chapterCount).map { ci ->
            val c = l.bible.chapters[book.firstChapter + ci]
            var w = 0; var v = st.read.nextSetBit(c.firstVerse)
            while (v in 0..c.lastVerse) { w += l.bible.words[v]; v = st.read.nextSetBit(v + 1) }
            w to c.words
        }
    }
    val readWords = chapterRead.sumOf { it.first }
    val ranges = remember(st.read.cardinality(), bookIndex) {
        val out = ArrayList<String>()
        var v = st.read.nextSetBit(book.firstVerse)
        while (v in 0..book.lastVerse) {
            val end = minOf(st.read.nextClearBit(v) - 1, book.lastVerse)
            out += Format.ref(l.bible, v, end).removePrefix(if (book.code == "PSA") "Psalm " else book.name + " ")
            v = st.read.nextSetBit(end + 1)
        }
        out
    }
    Box(Modifier.fillMaxSize().background(p.app)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 64.dp, bottom = 120.dp)) {
            Eyebrow(if (book.isOt) "Old Testament" else "New Testament", Modifier.appear(0))
            Text(book.name, Modifier.padding(top = 6.dp).appear(40).semantics { heading() }, serif(34f, 300, 60f, line = 1.05f, tracking = -0.02f))
            Text(book.intro, Modifier.padding(top = 14.dp).appear(80), serif(14.5f, 400, 15f, italic = true, line = 1.55f), p.ink2)
            Row(Modifier.padding(top = 24.dp).appear(120), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                Column { CountText(readWords * 100f / book.words, serif(28f, 300, 48f), format = { Format.progressPercent((it * 1000).toInt(), 100_000) + "%" }); Text("read", style = sans(11f), color = p.ink3) }
                Column { Text(Format.number(book.words), style = serif(28f, 300, 48f)); Text("words", style = sans(11f), color = p.ink3) }
                Column { Text("${book.chapterCount}", style = serif(28f, 300, 48f)); Text("chapters", style = sans(11f), color = p.ink3) }
            }
            Eyebrow("Chapters", Modifier.padding(top = 30.dp, bottom = 6.dp))
            chapterRead.forEachIndexed { i, (r, t) ->
                Row(Modifier.fillMaxWidth().pressable(pressedScale = 0.985f, role = null) { vm.openChapter(book.firstChapter + i) }.padding(vertical = 9.dp).semantics {
                    contentDescription = "Chapter ${i + 1}, ${Math.round(r * 100f / t)} percent read"
                }, verticalAlignment = Alignment.CenterVertically) {
                    Text("${i + 1}", Modifier.width(34.dp), sans(12f, 500), p.ink2)
                    Box(Modifier.weight(1f)) { GrowBar(r.toFloat() / t, delayMs = (i % 20) * 25) }
                    Text("${Math.round(r * 100f / t)}%", Modifier.width(42.dp), sans(11f), p.ink3, textAlign = androidx.compose.ui.text.style.TextAlign.End)
                }
            }
            Eyebrow("Passages read", Modifier.padding(top = 28.dp, bottom = 8.dp))
            Text(if (ranges.isEmpty()) "Nothing read in ${book.name} yet." else ranges.take(24).joinToString(", ") + if (ranges.size > 24) " and ${ranges.size - 24} more" else "", style = sans(12.5f), color = p.ink2)
        }
        Box(Modifier.statusBarsPadding().padding(16.dp, 6.dp)) { CircleButton(Ic.BACK, "Back") { vm.pop() } }
    }
}
