package com.bibledaily.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.bibledaily.app.*

private val TabIcons = listOf(Tab.Today to Ic.TODAY, Tab.Progress to Ic.PROGRESS, Tab.Settings to Ic.SETTINGS)

@Composable
private fun TabBar(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val p = C.p
    val h = rememberHaptics()
    var w by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val itemW = with(density) { (w / 3).toDp() }
    val x by animateDpAsState(itemW * current.ordinal, springy(0.72f, 380f), label = "tabx")
    Box(
        modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp).navigationBarsPadding().fillMaxWidth().height(56.dp)
            .shadow(14.dp, RoundedCornerShape(28.dp), ambientColor = androidx.compose.ui.graphics.Color(0x33000000), spotColor = androidx.compose.ui.graphics.Color(0x33000000))
            .clip(RoundedCornerShape(28.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(28.dp))
            .androidx_onSize { w = it },
    ) {
        Box(Modifier.offset(x = x).width(itemW).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            Box(Modifier.padding(top = 4.dp).size(16.dp, 2.5.dp).clip(RoundedCornerShape(2.dp)).background(p.gold))
        }
        Row(Modifier.fillMaxSize()) {
            TabIcons.forEach { (tab, icon) ->
                val on = tab == current
                val s by animateFloatAsState(if (on) 1.08f else 1f, springy(0.45f, 500f), label = "ts")
                val c by animateColorAsState(if (on) p.ink else p.ink3, motion(200), label = "tc")
                Column(
                    Modifier.weight(1f).fillMaxHeight().pressable(pressedScale = 0.9f, haptic = !on, role = Role.Tab) { onSelect(tab) }
                        .semantics { contentDescription = tab.name },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    PathIcon(icon, 21.dp, c, 1.6f, modifier = Modifier.scale(s))
                    Text(tab.name, Modifier.padding(top = 2.dp), sans(10f, 500), c)
                }
            }
        }
    }
}

private fun Modifier.androidx_onSize(f: (Int) -> Unit) = this.then(Modifier.onGloballyPositioned { f(it.size.width) })

@Composable
fun BibleApp(vm: AppViewModel) {
    val l = vm.loaded
    val settings = l?.ctrl?.state?.collectAsState()?.value?.settings
    BibleTheme(settings?.theme ?: com.bibledaily.app.data.ThemeMode.SYSTEM, settings?.textScale ?: 1f) {
        val p = C.p
        Box(Modifier.fillMaxSize().background(p.app)) {
            if (l != null && settings != null) {
                AppContent(vm, l)
                if (!settings.onboarded) Onboarding(vm, l)
            }
        }
    }
}

@Composable
private fun AppContent(vm: AppViewModel, l: Loaded) {
    val p = C.p
    val top = vm.stack.lastOrNull()
    val hideTabs = top is Route.Reader || top is Route.ExtraReader || top is Route.Browse

    BackHandler(vm.sheet != null) { vm.sheet = null }
    BackHandler(vm.sheet == null && vm.stack.isNotEmpty()) { vm.pop() }
    BackHandler(vm.sheet == null && vm.stack.isEmpty() && vm.tab != Tab.Today) { vm.selectTab(Tab.Today) }

    Box(Modifier.fillMaxSize()) {
        AnimatedContent(
            vm.tab,
            transitionSpec = {
                val d = vm.tabDirection
                (slideInHorizontally(tween(340, easing = EaseOutExpo)) { it / 7 * d } + fadeIn(tween(260))) togetherWith
                    (slideOutHorizontally(tween(260)) { -it / 9 * d } + fadeOut(tween(160)))
            }, label = "tabs",
        ) { t ->
            when (t) {
                Tab.Today -> TodayScreen(vm, l)
                Tab.Progress -> ProgressScreen(vm, l)
                Tab.Settings -> SettingsScreen(vm, l)
            }
        }

        // pushed screens slide over the tab content
        AnimatedContent(
            top,
            Modifier.fillMaxSize().zIndex(2f),
            transitionSpec = {
                val up = targetState is Route.Reader || targetState is Route.ExtraReader || targetState is Route.Browse
                when {
                    targetState == null -> fadeIn(tween(1)) togetherWith (slideOutVertically(tween(300, easing = FastOutLinearInEasing)) { it / 6 } + fadeOut(tween(240)))
                    up -> (slideInVertically(tween(420, easing = EaseOutExpo)) { it / 5 } + fadeIn(tween(300))) togetherWith fadeOut(tween(160))
                    initialState is Route.Reader && targetState is Route.Done -> fadeIn(tween(420, 120)) togetherWith fadeOut(tween(200))
                    else -> (slideInHorizontally(tween(360, easing = EaseOutExpo)) { it / 5 } + fadeIn(tween(260))) togetherWith fadeOut(tween(160))
                }.using(SizeTransform(clip = false))
            }, label = "stack", contentKey = { it?.let { r -> r::class } },
        ) { r ->
            when (r) {
                null -> Box(Modifier.fillMaxSize())
                Route.Reader, Route.ExtraReader, is Route.Browse -> ReaderScreen(vm, l, r)
                is Route.Done -> Box(Modifier.fillMaxSize().background(p.app)) { DoneScreen(vm, l, r) }
                is Route.BookDetail -> BookDetailScreen(vm, l, r.book)
                Route.AllBooks -> AllBooksScreen(vm, l)
                Route.About -> AboutScreen(vm)
                Route.Finished -> Box(Modifier.fillMaxSize().background(p.app)) { TodayScreen(vm, l) }
            }
        }

        AnimatedVisibility(
            !hideTabs, Modifier.align(Alignment.BottomCenter).zIndex(3f),
            enter = slideInVertically(springy(0.8f, 380f)) { it } + fadeIn(), exit = slideOutVertically(tween(220)) { it } + fadeOut(tween(160)),
        ) { TabBar(vm.tab, { vm.selectTab(it) }) }

        Sheets(vm, l)
        Toast(vm.toastTitle, vm.toastDetail, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 86.dp))
    }
}
