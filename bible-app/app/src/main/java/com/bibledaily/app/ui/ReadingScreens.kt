package com.bibledaily.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.compose.ui.window.Popup
import com.bibledaily.app.*
import com.bibledaily.app.data.ReadingStatus
import com.bibledaily.app.domain.*
import com.bibledaily.app.engine.Passage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

private fun excerpt(l: Loaded, passages: List<Passage>, maxChars: Int = 230): String {
    val sb = StringBuilder()
    val p = passages.first()
    for (v in p.first..p.last) {
        val t = l.bible.texts[v]
        if (t.isEmpty()) continue
        if (sb.isNotEmpty()) sb.append(' ')
        sb.append(t)
        if (sb.length >= maxChars) break
    }
    return sb.toString()
}

// ====================================================================== Today

@Composable
fun TodayScreen(vm: AppViewModel, l: Loaded) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val today = l.ctrl.clock.today()
    val stats = remember(st.read.cardinality(), st.history.size, st.settings.dailyWords) { Stats.compute(l.bible, st, today) }
    val reading = st.today
    val active = reading?.takeIf { it.status == ReadingStatus.ACTIVE }
    val verse = remember(st.installSeed, today) { vm.verseOfToday(l) }
    var n = 0
    fun d() = (n++) * 55

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 14.dp, bottom = 120.dp)) {
        Row(Modifier.fillMaxWidth().appear(d()), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(Format.longDate(today), style = sans(12.5f), color = p.ink2)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(p.gold))
                Spacer(Modifier.width(6.dp))
                Text("${stats.streak}", style = sans(12.5f, 600))
                Text(if (stats.streak == 1) " day" else " days", style = sans(12.5f), color = p.ink2)
            }
        }
        Spacer(Modifier.height(32.dp))

        when {
            active != null -> {
                val resumed = st.history.lastOrNull { !it.extra }?.continuation == active.firstVerse
                Row(Modifier.appear(d()), verticalAlignment = Alignment.CenterVertically) {
                    Eyebrow("Today’s reading")
                    if (resumed) {
                        Spacer(Modifier.width(10.dp))
                        Text("Continues yesterday", Modifier.clip(RoundedCornerShape(8.dp)).background(p.goldWash).padding(8.dp, 3.dp), sans(10.5f, 600), p.goldInk)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text(Format.refs(l.bible, active.passages), Modifier.appear(d()).semantics { heading() },
                    serif(if (active.passages.size > 1) 26f else 34f, 300, 72f, line = 1.08f, tracking = -0.02f))
                Spacer(Modifier.height(10.dp))
                Row(Modifier.appear(d()), verticalAlignment = Alignment.CenterVertically) {
                    Text("${Format.number(active.words)} words", style = sans(12.5f), color = p.ink3)
                    Box(Modifier.padding(horizontal = 8.dp).size(3.dp).clip(CircleShape).background(p.ink3))
                    Text(Format.minutesText(active.words), style = sans(12.5f), color = p.ink3)
                }
                Text(excerpt(l, active.passages), Modifier.padding(top = 22.dp, bottom = 26.dp).appear(d()),
                    serif(16f, 400, 16f, italic = true, line = 1.6f), p.ink2, maxLines = 3)
                Box(Modifier.appear(d())) { AppButton("Begin reading", { vm.beginReading() }) }
                Text("Within your ${Format.number(st.settings.dailyWords)}-word limit", Modifier.fillMaxWidth().padding(top = 12.dp).appear(d()),
                    sans(11.5f), p.ink3, textAlign = TextAlign.Center)
            }
            reading?.status == ReadingStatus.DONE -> DoneToday(vm, l, st.queued)
            else -> FinishedCard(vm)
        }

        Rule(Modifier.appear(d()))
        Column(Modifier.appear(d())) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Row(verticalAlignment = Alignment.Bottom) {
                    CountText(stats.fraction * 100f, serif(24f, 400, 36f), format = { Format.progressPercent((it * 1000).toInt(), 100_000) + "%" }, durationMs = 1100)
                    Text("  of the Bible", style = sans(12f), color = p.ink3, modifier = Modifier.padding(bottom = 3.dp))
                }
                Text("${Format.number(stats.readings)} readings", style = sans(12f), color = p.ink3)
            }
            Spacer(Modifier.height(12.dp))
            CanonMap(l.bible, st.read, CanonVariant.Mini, today = active?.let { it.firstVerse..it.lastVerse },
                label = "Canon map. ${Format.progressPercent(stats.wordsRead, stats.totalWords)} percent of the Bible read.")
            Row(Modifier.padding(top = 10.dp)) {
                Box(Modifier.padding(top = 4.dp).size(8.dp, 4.dp).clip(RoundedCornerShape(2.dp)).background(p.gold))
                Text("  Read", style = sans(10.5f), color = p.ink3)
                Spacer(Modifier.width(14.dp))
                Box(Modifier.padding(top = 0.dp).size(2.dp, 9.dp).background(p.ink))
                Text("  Today’s passage", style = sans(10.5f), color = p.ink3)
            }
        }
        Rule(Modifier.appear(d()))
        Column(Modifier.fillMaxWidth().appear(d()).pressable(pressedScale = 0.985f, role = null) { vm.openVerseOfDay() }) {
            Eyebrow("Verse of the day")
            Text(verse.text, Modifier.padding(top = 12.dp, bottom = 10.dp), serif(17f, 400, 18f, line = 1.55f))
            Text(verse.ref, style = sans(11.5f, 600, tracking = 0.2f), color = p.goldInk)
        }
        if (st.history.size - st.readingsAtLastExport >= 30) {
            Spacer(Modifier.height(24.dp))
            var gone by remember { mutableStateOf(false) }
            AnimatedVisibility(!gone, exit = fadeOut() + shrinkVertically()) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(18.dp)).padding(16.dp)) {
                    Text("Back up your progress", style = sans(13.5f, 600))
                    Text("You’ve finished ${st.history.size - st.readingsAtLastExport} readings since you last exported. A small file keeps them safe if you change phones.",
                        Modifier.padding(top = 4.dp), sans(12f), p.ink3)
                    Row(Modifier.padding(top = 12.dp)) {
                        Text("Export progress", Modifier.pressable { vm.selectTab(Tab.Settings) }.padding(end = 20.dp, top = 4.dp, bottom = 4.dp), sans(12.5f, 600), p.goldInk)
                        Text("Not now", Modifier.pressable { gone = true }.padding(vertical = 4.dp), sans(12.5f, 500), p.ink3)
                    }
                }
            }
        }
    }
}

@Composable
private fun DoneToday(vm: AppViewModel, l: Loaded, queued: com.bibledaily.app.data.Reading?) {
    val p = C.p
    Column(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Seal(Modifier.appear(0), 54)
        Spacer(Modifier.height(20.dp))
        Text("Read for today.", Modifier.appear(80).semantics { heading() }, serif(32f, 300, 60f, italic = true, line = 1.05f, tracking = -0.015f))
        if (queued != null) {
            Text("Tomorrow: ${Format.refs(l.bible, queued.passages)}", Modifier.padding(top = 10.dp).appear(140), sans(12.5f), p.ink3)
        }
        Spacer(Modifier.height(22.dp))
        Box(Modifier.appear(200)) { AppButton("Read another passage", { vm.readAnother() }, kind = BtnKind.Ghost) }
        Text("Optional. It counts toward your progress, not your streak.", Modifier.padding(top = 12.dp).appear(240), sans(11.5f), p.ink3, textAlign = TextAlign.Center)
    }
}

@Composable
private fun FinishedCard(vm: AppViewModel) {
    val p = C.p
    Column(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Seal(Modifier, 54)
        Spacer(Modifier.height(20.dp))
        Text("You’ve read the whole Bible.", style = serif(30f, 300, 60f, italic = true, line = 1.1f), textAlign = TextAlign.Center)
        Text("Every passage, once. Start a new round whenever you like; your history stays.", Modifier.padding(top = 10.dp, bottom = 22.dp), sans(13f), p.ink2, textAlign = TextAlign.Center)
        AppButton("Start a new round", { vm.startNewRound() })
    }
}

/** A gold ring that draws itself, then a check. */
@Composable
fun Seal(modifier: Modifier = Modifier, sizeDp: Int = 54, delayMs: Int = 150) {
    val p = C.p
    val reduce = LocalReduceMotion.current
    val ring = remember { Animatable(if (reduce) 1f else 0f) }
    val check = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduce) { delay(delayMs.toLong()); ring.animateTo(1f, tween(650, easing = EaseOutExpo)); check.animateTo(1f, tween(380, easing = EaseOutExpo)) }
    }
    Box(modifier.size(sizeDp.dp).graphicsLayer { val s = 0.85f + 0.15f * ring.value; scaleX = s; scaleY = s }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            drawArc(p.gold, -90f, 360f * ring.value, false, style = Stroke(1.2.dp.toPx(), cap = StrokeCap.Round), topLeft = Offset(1f, 1f), size = Size(size.width - 2f, size.height - 2f))
        }
        PathIcon(Ic.CHECK, (sizeDp * 0.41f).dp, p.gold, 1.9f, progress = check.value)
    }
}

// ====================================================================== Reader

private class Block(val indent: Int, val text: AnnotatedString, val heading: String? = null)

private fun blocksFor(l: Loaded, p: Passage, showNumbers: Boolean, gold: Color, goldFont: androidx.compose.ui.text.font.FontFamily): List<Block> {
    val out = ArrayList<Block>()
    var sb = AnnotatedString.Builder()
    var open = false
    var level = 0
    fun flush() { if (open) { out += Block(level, sb.toAnnotatedString()); sb = AnnotatedString.Builder(); open = false } }
    for (v in p.first..p.last) {
        val t = l.bible.texts[v]
        val heading = l.bible.headings[v]
        if (heading.isNotEmpty()) { flush(); out += Block(0, AnnotatedString(""), heading) }
        if (t.isEmpty()) continue
        val poetry = l.bible.poetry(v)
        if (poetry > 0 || (l.bible.paraStart(v) && open)) flush()
        if (!open) level = poetry
        if (open) sb.append(" ")
        if (showNumbers) {
            sb.withStyle(SpanStyle(fontFamily = goldFont, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = gold, baselineShift = BaselineShift.Superscript)) { append(l.bible.verseNumber(v).toString()) }
            sb.append(" ")
        }
        sb.append(t)
        open = true
        if (poetry > 0) flush()
    }
    flush()
    return out
}

@Composable
fun ReaderScreen(vm: AppViewModel, l: Loaded, route: Route) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val h = rememberHaptics()
    val isBrowse = route is Route.Browse
    val isExtra = route is Route.ExtraReader
    val reading = if (isExtra) st.extra else st.today
    var menu by remember { mutableStateOf(false) }
    var scaleBump by remember { mutableFloatStateOf(1f) }
    val textScale = st.settings.textScale * scaleBump

    BackHandler(menu) { menu = false }
    BackHandler(!menu) { if (isExtra) l.ctrl.discardExtra(); vm.pop() }

    val passages: List<Passage> = when {
        route is Route.Browse -> { val c = l.bible.chapters[route.chapter]; listOf(Passage(c.firstVerse, c.lastVerse, c.words)) }
        reading != null -> reading.passages
        else -> { LaunchedEffect(Unit) { vm.pop() }; return }
    }
    val first = passages.first()
    val book = l.bible.book(first.first)
    val chNum = l.bible.chapterNumber(first.first)
    val scrolled = scroll.value > 120
    val navAlpha by animateFloatAsState(if (scrolled) 1f else 0f, motion(180), label = "nav")
    val goldFont = remember { sans(9f, 600).fontFamily!! }

    Box(Modifier.fillMaxSize().background(p.app)) {
        // reading-position hairline
        Box(Modifier.fillMaxWidth().statusBarsPadding().height(2.dp).zIndex(6f)) {
            val f = if (scroll.maxValue > 0) scroll.value.toFloat() / scroll.maxValue else 0f
            Box(Modifier.fillMaxWidth(f).fillMaxHeight().background(p.gold))
        }
        AnimatedContent(
            targetState = (reading?.id ?: -1L) to (route as? Route.Browse)?.chapter,
            transitionSpec = { fadeIn(tween(280)) togetherWith fadeOut(tween(160)) }, label = "reading",
        ) { _ ->
            Column(Modifier.fillMaxSize().verticalScroll(scroll).statusBarsPadding().padding(top = 58.dp, start = 22.dp, end = 22.dp, bottom = if (isBrowse) 40.dp else 190.dp)) {
                Eyebrow("${book.name} · Chapter $chNum of ${book.chapterCount}", Modifier.appear(0))
                Spacer(Modifier.height(8.dp))
                val title = if (isBrowse) "Chapter $chNum" else if (passages.size == 1) Format.verses(l.bible, first) else "${passages.size} passages"
                Text(title, Modifier.appear(40).semantics { heading(); contentDescription = Format.spokenRef(l.bible, first) }, serif(34f, 300, 60f, line = 1.05f, tracking = -0.02f))
                Text(book.intro, Modifier.padding(top = 14.dp).appear(80), serif(14.5f, 400, 15f, italic = true, line = 1.55f), p.ink2)
                if (!isBrowse && reading != null) {
                    val before = st.history.lastOrNull { h2 -> h2.passages.any { it.last == first.first - 1 } }
                    if (before != null) {
                        val d = runCatching { Format.shortDate(LocalDate.parse(before.date)) }.getOrDefault("")
                        Row(Modifier.padding(top = 14.dp).appear(110), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(14.dp, 1.dp).background(p.ink3)); Spacer(Modifier.width(8.dp))
                            Text("Before this: ${Format.ref(l.bible, before.passages.last())}, read $d", style = sans(11.5f), color = p.ink3)
                        }
                    }
                }
                SelectionContainer {
                    Column(Modifier.padding(top = 26.dp)) {
                        var idx = 0
                        passages.forEachIndexed { pi, ps ->
                            if (passages.size > 1) {
                                Text(Format.ref(l.bible, ps), Modifier.padding(top = if (pi == 0) 0.dp else 28.dp, bottom = 14.dp).semantics { heading() }, serif(20f, 400, 24f, line = 1.2f), p.goldInk)
                            }
                            blocksFor(l, ps, st.settings.verseNumbers, p.goldInk, goldFont).forEach { b ->
                                if (b.heading != null) {
                                    Text(b.heading, Modifier.padding(bottom = 12.dp), serif(14.5f * textScale, 400, 15f, italic = true, line = 1.4f), p.ink2)
                                } else {
                                    androidx.compose.foundation.text.BasicText(
                                        b.text,
                                        Modifier.padding(start = (b.indent * 18).dp, bottom = if (b.indent > 0) 6.dp else 16.dp).appear(120 + min(idx++, 8) * 45),
                                        style = serif(16.5f * textScale, 400, 16f, line = 1.78f).copy(color = p.ink),
                                    )
                                }
                            }
                        }
                    }
                }
                if (!isBrowse) {
                    Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 24.dp), contentAlignment = Alignment.Center) { Diamond() }
                    val cont = reading?.continuation ?: -1
                    if (cont >= 0) {
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(18.dp)).padding(16.dp)) {
                            Eyebrow(if (reading?.forced == true) "Continues tomorrow" else "Continues tomorrow")
                            Text("Picks up at ${Format.ref(l.bible, cont, cont)}", Modifier.padding(top = 6.dp, bottom = 4.dp), serif(19f, 400, 24f, line = 1.2f))
                            Text(if (reading?.forced == true) "This list is one long sentence, so it is split between verses to stay within your limit." else "Today stops at a paragraph break to stay within your limit. Tomorrow picks up from here.",
                                style = sans(12f), color = p.ink3)
                        }
                    }
                } else {
                    Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        val ci = (route as Route.Browse).chapter
                        if (ci > 0) Box(Modifier.weight(1f)) { AppButton("Previous chapter", { vm.replaceTop(Route.Browse(ci - 1)); scope.launch { scroll.scrollTo(0) } }, kind = BtnKind.Ghost) }
                        if (ci < l.bible.chapters.size - 1) Box(Modifier.weight(1f)) { AppButton("Next chapter", { vm.replaceTop(Route.Browse(ci + 1)); scope.launch { scroll.scrollTo(0) } }, kind = BtnKind.Ghost) }
                    }
                    Text("Browsing doesn’t count toward your progress.", Modifier.fillMaxWidth().padding(top = 12.dp), sans(11.5f), p.ink3, textAlign = TextAlign.Center)
                }
            }
        }

        // top bar
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 6.dp).zIndex(5f), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            CircleButton(Ic.BACK, "Back") { if (isExtra) l.ctrl.discardExtra(); vm.pop() }
            Text(if (isBrowse) "${book.name} $chNum" else "${book.name} $chNum", Modifier.alpha(navAlpha), sans(13f, 600))
            if (isBrowse) Spacer(Modifier.size(38.dp)) else CircleButton("M5 12h.01M12 12h.01M19 12h.01", "More options") { menu = !menu }
        }
        if (menu) {
            Popup(alignment = Alignment.TopEnd, offset = androidx.compose.ui.unit.IntOffset(-40, 190), onDismissRequest = { menu = false }) {
                val appear = remember { Animatable(0f) }
                LaunchedEffect(Unit) { appear.animateTo(1f, spring(0.7f, 500f)) }
                Column(
                    Modifier.graphicsLayer { alpha = appear.value.coerceIn(0f, 1f); scaleX = 0.9f + 0.1f * appear.value; scaleY = scaleX; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0f) }
                        .width(260.dp).clip(RoundedCornerShape(18.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(18.dp)).padding(vertical = 6.dp),
                ) {
                    val left = l.ctrl.swapsLeft()
                    if (!isExtra) MenuItem("Choose a different passage", "$left left today", enabled = left > 0) {
                        if (vm.swap()) { menu = false; vm.toast("New passage chosen"); scope.launch { scroll.animateScrollTo(0) } }
                    }
                    MenuItem("Read the whole chapter", null) { menu = false; vm.openChapter(l.bible.chapterOfVerse[first.first]) }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Text size", Modifier.weight(1f), sans(13.5f, 500))
                        Text("A−", Modifier.pressable { vm.update { s -> s.copy(textScale = (s.textScale - 0.1f).coerceAtLeast(0.8f)) } }.padding(10.dp), sans(14f, 600))
                        Text("${(st.settings.textScale * 100).toInt()}%", style = sans(12f), color = p.ink3)
                        Text("A+", Modifier.pressable { vm.update { s -> s.copy(textScale = (s.textScale + 0.1f).coerceAtMost(1.6f)) } }.padding(10.dp), sans(17f, 600))
                    }
                }
            }
        }

        // floating action panel
        if (!isBrowse && reading != null) {
            val fill = min(1f, reading.words.toFloat() / reading.limit.coerceAtLeast(1))
            val meter = remember(reading.id) { Animatable(0f) }
            LaunchedEffect(reading.id) { meter.animateTo(fill, if (false) snap() else tween(900, 180, EaseOutExpo)) }
            Column(
                Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(14.dp).fillMaxWidth()
                    .clip(RoundedCornerShape(26.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(26.dp)).padding(12.dp),
            ) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${Format.number(reading.words)} of ${Format.number(reading.limit)} words", style = sans(11.5f), color = p.ink3)
                    Text(Format.minutesText(reading.words), style = sans(11.5f), color = p.ink3)
                }
                Box(Modifier.padding(start = 4.dp, end = 4.dp, top = 8.dp, bottom = 12.dp).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(p.empty)) {
                    Box(Modifier.fillMaxWidth(meter.value).fillMaxHeight().background(p.gold))
                }
                MarkButton(key = reading.id) { vm.markRead(isExtra) }
            }
        }
    }
}

@Composable
private fun MenuItem(title: String, sub: String?, enabled: Boolean = true, onClick: () -> Unit) {
    val p = C.p
    Row(Modifier.fillMaxWidth().pressable(enabled, pressedScale = 0.98f, onClick = onClick).alpha(if (enabled) 1f else 0.4f).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), sans(13.5f, 500))
        if (sub != null) Text(sub, style = sans(11.5f), color = p.ink3)
    }
}

/** "Mark as read": the button fills with gold, a check draws itself, and a small burst of gold leaf scatters. */
@Composable
fun MarkButton(key: Any, onComplete: () -> Unit) {
    val p = C.p
    val h = rememberHaptics()
    val reduce = LocalReduceMotion.current
    val scope = rememberCoroutineScope()
    var phase by remember(key) { mutableIntStateOf(0) }
    val fill = remember(key) { Animatable(0f) }
    val burst = remember(key) { Animatable(0f) }
    val check = remember(key) { Animatable(0f) }
    Box(Modifier.fillMaxWidth().height(50.dp)) {
        Box(
            Modifier.fillMaxSize().pressable(enabled = phase == 0) {
                phase = 1; h.confirm()
                scope.launch {
                    if (reduce) { onComplete(); return@launch }
                    launch { burst.animateTo(1f, tween(750, easing = EaseOutExpo)) }
                    fill.animateTo(1f, tween(300, easing = FastOutSlowInEasing))
                    check.animateTo(1f, tween(320, easing = EaseOutExpo))
                    delay(320)
                    onComplete()
                }
            }.clip(RoundedCornerShape(16.dp)).background(p.btn),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) { drawRect(p.gold, Offset.Zero, Size(size.width * fill.value, size.height)) }
            Text("Mark as read", Modifier.alpha(1f - fill.value), sans(14.5f, 600), p.btnInk)
            PathIcon(Ic.CHECK, 24.dp, Color.White, 2.2f, progress = check.value, modifier = Modifier.alpha(fill.value))
        }
        Canvas(Modifier.fillMaxSize()) {
            val t = burst.value
            if (t > 0f && t < 1f) {
                val c = Offset(size.width / 2, size.height / 2)
                for (i in 0 until 16) {
                    val a = i * (Math.PI * 2 / 16) + (i % 3) * 0.2
                    val dist = (40.dp.toPx() + (i % 4) * 14.dp.toPx()) * t
                    val r = (3.5.dp.toPx() - (i % 3) * 0.8.dp.toPx()) * (1f - t * 0.7f)
                    drawCircle((if (i % 2 == 0) p.gold2 else p.gold).copy(alpha = (1f - t).coerceIn(0f, 1f)), r,
                        Offset(c.x + cos(a).toFloat() * dist * 1.6f, c.y + sin(a).toFloat() * dist * 0.9f - 6.dp.toPx() * t))
                }
            }
        }
    }
}

// ====================================================================== Done

@Composable
fun DoneScreen(vm: AppViewModel, l: Loaded, route: Route.Done) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val c = route.completion
    val today = l.ctrl.clock.today()
    val stats = remember(st.read.cardinality()) { Stats.compute(l.bible, st, today) }
    val queued = st.queued
    val before = Format.progressPercent(c.wordsBefore, l.bible.totalWords)
    val delta = (c.wordsAfter - c.wordsBefore) * 100.0 / l.bible.totalWords
    val pop = remember { Animatable(0f) }
    LaunchedEffect(Unit) { delay(900); pop.animateTo(1f, spring(0.45f, 380f)) }
    val h = rememberHaptics()
    LaunchedEffect(Unit) { delay(1000); h.tick() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 38.dp, bottom = 120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Seal(Modifier, 54, 120)
        Spacer(Modifier.height(22.dp))
        Text("Read for today.", Modifier.appear(300).semantics { heading() }, serif(32f, 300, 60f, italic = true, line = 1.05f, tracking = -0.015f))
        Text("${Format.refs(l.bible, c.reading.passages)} · ${Format.number(c.reading.words)} words", Modifier.padding(top = 10.dp).appear(380), sans(12.5f), p.ink3)
        Spacer(Modifier.height(30.dp))
        Row(Modifier.appear(450), verticalAlignment = Alignment.Top) {
            CountText(c.wordsAfter.toFloat(), serif(52f, 300, 72f, line = 1f, tracking = -0.02f), durationMs = 1300, from = c.wordsBefore.toFloat(),
                format = { v -> Format.progressPercent(v.toInt(), l.bible.totalWords) + "%" })
            Text("+${String.format("%.2f", delta)}%", Modifier.padding(start = 6.dp, top = 6.dp).graphicsLayer { scaleX = pop.value; scaleY = pop.value; alpha = pop.value.coerceIn(0f, 1f) }, sans(12f, 600), p.goldInk)
        }
        Text("of the Bible read", Modifier.padding(top = 6.dp, bottom = 22.dp).appear(480), sans(12f), p.ink3)
        CanonMap(l.bible, st.read, CanonVariant.Done, today = c.reading.passages.first().first..c.reading.passages.last().last,
            label = "Canon map with today's passage highlighted. ${Format.progressPercent(c.wordsAfter, l.bible.totalWords)} percent read.")
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(8.dp).border(1.5.dp, p.gold2, CircleShape)); Text("  Today", style = sans(10.5f), color = p.ink3) }
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(8.dp, 4.dp).clip(RoundedCornerShape(2.dp)).background(p.gold)); Text("  Read before", style = sans(10.5f), color = p.ink3) }
        }
        Rule(Modifier.appear(600))
        if (!route.extra) Row(Modifier.fillMaxWidth().appear(640), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row { Text("${c.streakAfter}", style = sans(12.5f, 600)); Text("-day streak", style = sans(12.5f), color = p.ink2) }
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                val n = min(7, max(1, c.streakAfter))
                repeat(7) { i ->
                    val on = i >= 7 - n
                    val now = i == 6
                    val s = remember { Animatable(0f) }
                    LaunchedEffect(Unit) { delay(700L + i * 60L); s.animateTo(1f, spring(0.5f, 420f)) }
                    Box(Modifier.size(7.dp).graphicsLayer { scaleX = s.value; scaleY = s.value }.then(if (now) Modifier.border(3.dp, p.goldWash, CircleShape) else Modifier)
                        .clip(CircleShape).background(if (now) p.gold else p.ink.copy(alpha = if (on) 0.8f else 0.15f)))
                }
            }
        } else Text("Extra readings count toward your progress, not your streak.", Modifier.appear(640), sans(12f), p.ink3)
        if (queued != null) {
            Column(Modifier.padding(top = 18.dp, bottom = 14.dp).fillMaxWidth().appear(700).clip(RoundedCornerShape(18.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(18.dp)).padding(16.dp)) {
                Eyebrow("Tomorrow")
                Text(Format.refs(l.bible, queued.passages), Modifier.padding(top = 6.dp, bottom = 4.dp), serif(19f, 400, 24f, line = 1.2f))
                Text("${Format.number(queued.words)} words" + if (st.history.lastOrNull()?.continuation == queued.firstVerse) " · carries on from today" else "", style = sans(12f), color = p.ink3)
            }
        } else if (l.ctrl.finished) {
            Spacer(Modifier.height(18.dp))
            Box(Modifier.appear(700)) { AppButton("You’ve finished the Bible. Start a new round", { vm.startNewRound() }) }
        }
        if (queued != null) {
            Box(Modifier.appear(760)) { AppButton("Read another passage", { vm.readAnother() }, kind = BtnKind.Ghost) }
            Text("Optional. It counts toward your progress, not your streak.", Modifier.padding(top = 12.dp).appear(790), sans(11.5f), p.ink3, textAlign = TextAlign.Center)
        }
    }
}
