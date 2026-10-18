package com.bibledaily.app.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.bibledaily.app.*
import com.bibledaily.app.domain.Format
import kotlinx.coroutines.launch
import java.util.BitSet
import java.util.Random

@Composable
private fun IconArt(modifier: Modifier = Modifier) {
    val p = C.p
    val drop = remember { Animatable(0f) }
    LaunchedEffect(Unit) { drop.animateTo(1f, spring(0.55f, 90f)) }
    Canvas(modifier.size(150.dp)) {
        val k = size.width / 1024f * 1.55f
        val ox = (size.width - 1024f * k) / 2 + 0f
        val oy = -150f * k
        fun r(x: Float, y: Float, w: Float, c: Color) = drawRoundRect(c, Offset(ox + x * k, oy + y * k), Size(w * k, 44f * k), CornerRadius(22f * k))
        r(232f, 356f, 560f, p.gold)
        val grey = p.hair2
        r(232f, 444f, 560f, grey); r(232f, 532f, 560f, grey); r(232f, 620f, 336f, grey)
        val top = -300f + drop.value * 300f
        val path = Path().apply {
            moveTo(ox + 452f * k, oy + (top - 260f) * k); lineTo(ox + 572f * k, oy + (top - 260f) * k); lineTo(ox + 572f * k, oy + (top + 752f) * k)
            lineTo(ox + 512f * k, oy + (top + 694f) * k); lineTo(ox + 452f * k, oy + (top + 752f) * k); close()
        }
        drawPath(path, Brush.horizontalGradient(listOf(Color(0xFFC99A44), Color(0xFFE6C47E), Color(0xFFB78935)), ox + 452f * k, ox + 572f * k))
    }
}

@Composable
fun Onboarding(vm: AppViewModel, l: Loaded) {
    val p = C.p
    val st by l.ctrl.state.collectAsState()
    val pager = rememberPagerState { 4 }
    val scope = rememberCoroutineScope()
    val sample = remember {
        val b = BitSet(l.bible.verseCount); val r = Random(5)
        repeat(150) { val s = r.nextInt(l.bible.verseCount - 30); b.set(s, s + 6 + r.nextInt(14)) }; b
    }
    Column(Modifier.fillMaxSize().background(p.app).zIndex(40f).statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp)) {
        HorizontalPager(pager, Modifier.weight(1f)) { page ->
            Column(Modifier.fillMaxSize().padding(top = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.height(190.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    when (page) {
                        0 -> IconArt()
                        1 -> CanonMap(l.bible, sample, CanonVariant.Done, Modifier.padding(horizontal = 4.dp))
                        2 -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Never twice", style = serif(44f, 300, 72f, italic = true, line = 1.05f, tracking = -0.02f))
                            Text("every verse, once", Modifier.padding(top = 8.dp), sans(13f), p.ink3)
                        }
                        else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            RollingText(Format.number(st.settings.dailyWords), serif(64f, 200, 72f, line = 1f, tracking = -0.03f), up = true)
                            Text("words · ${Format.minutesText(st.settings.dailyWords)}", Modifier.padding(top = 6.dp), sans(13f), p.ink3)
                        }
                    }
                }
                Spacer(Modifier.height(30.dp))
                val (h, b) = when (page) {
                    0 -> "One passage a day" to "Each day the app picks a short reading at random from the parts of Scripture you haven’t read yet."
                    1 -> "Whole sentences, always" to "A reading ends at the end of a sentence, usually at a paragraph break, and starts where a chapter begins or an earlier reading stopped."
                    2 -> "Never the same passage twice" to "Your progress is kept verse by verse, so nothing comes round again until you’ve read it all."
                    else -> "Choose how much" to "Pick a length. A reading never goes over it. You can change it any time in Settings."
                }
                Text(h, Modifier.fillMaxWidth(), serif(28f, 300, 48f, line = 1.1f, tracking = -0.015f), textAlign = TextAlign.Center)
                Text(b, Modifier.padding(top = 14.dp, start = 8.dp, end = 8.dp), serif(16f, 400, 16f, line = 1.5f), p.ink2, textAlign = TextAlign.Center)
                if (page == 3) {
                    Spacer(Modifier.height(24.dp))
                    Segmented(listOf("Short" to "150", "Standard" to "300", "Long" to "600"), listOf(150, 300, 600).indexOf(st.settings.dailyWords),
                        { l.ctrl.setDailyWords(listOf(150, 300, 600)[it]) })
                    Row(Modifier.fillMaxWidth().padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Daily reminder", style = sans(13.5f, 500))
                            Text(if (st.settings.reminderOn) Format.time(st.settings.reminderMinutes) else "Optional", style = sans(11.5f), color = p.ink3)
                        }
                        GoldSwitch(st.settings.reminderOn, { on -> vm.update { it.copy(reminderOn = on) } }, "Daily reminder")
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 18.dp), horizontalArrangement = Arrangement.Center) {
            repeat(4) { i ->
                val on = pager.currentPage == i
                val w by animateDpAsState(if (on) 22.dp else 6.dp, springy(0.7f, 500f), label = "dot")
                Box(Modifier.padding(horizontal = 3.dp).size(w, 6.dp).clip(CircleShape).background(if (on) p.gold else p.hair2))
            }
        }
        AppButton(if (pager.currentPage == 3) "Get started" else "Continue", {
            if (pager.currentPage == 3) vm.update { it.copy(onboarded = true) } else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
        })
        Spacer(Modifier.height(10.dp))
    }
}
