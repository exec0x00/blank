package com.bibledaily.app.ui

import android.Manifest
import android.app.TimePickerDialog
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.bibledaily.app.*
import com.bibledaily.app.data.ThemeMode
import com.bibledaily.app.domain.*
import java.time.LocalDate

@Composable
private fun Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val p = C.p
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(18.dp)), content = content)
}

@Composable
private fun GroupLabel(text: String, first: Boolean = false) =
    Eyebrow(text, Modifier.padding(start = 4.dp, end = 4.dp, top = if (first) 0.dp else 26.dp, bottom = 8.dp))

@Composable
private fun Item(
    title: String, sub: String? = null, divider: Boolean = true, titleColor: androidx.compose.ui.graphics.Color = C.p.ink,
    onClick: (() -> Unit)? = null, trailing: @Composable () -> Unit = {},
) {
    val p = C.p
    Box {
        if (divider) Box(Modifier.padding(start = 16.dp).fillMaxWidth().height(1.dp).background(p.hair))
        Row(
            Modifier.fillMaxWidth().then(if (onClick != null) Modifier.pressable(pressedScale = 0.985f, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick) else Modifier)
                .padding(horizontal = 16.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, style = sans(13.5f, 500), color = titleColor)
                if (sub != null) Text(sub, Modifier.padding(top = 2.dp), sans(11.5f), p.ink3)
            }
            trailing()
        }
    }
}

@Composable
fun SettingsScreen(vm: AppViewModel, l: Loaded) {
    val p = C.p
    val ctx = LocalContext.current
    val st by l.ctrl.state.collectAsState()
    val s = st.settings
    val today = l.ctrl.clock.today()
    val stats = remember(st.read.cardinality(), st.history.size) { Stats.compute(l.bible, st, today) }
    val active = st.today?.takeIf { it.status == com.bibledaily.app.data.ReadingStatus.ACTIVE }

    var draft by remember { mutableIntStateOf(s.dailyWords) }
    LaunchedEffect(s.dailyWords) { draft = s.dailyWords }
    var up by remember { mutableStateOf(true) }
    fun commit() {
        if (draft != s.dailyWords) {
            val rebuilt = l.ctrl.setDailyWords(draft)
            if (rebuilt) vm.toast("Today’s reading was rebuilt to fit", "It now stays within ${Format.number(draft)} words")
        }
    }
    val finishText = Format.finishText(l.bible.totalWords - stats.wordsRead, draft, Stats.averageFill(st.history))

    val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        vm.update { it.copy(reminderOn = true) }
        if (!ok) vm.toast("Notifications are off for Bible", "Turn them on in system settings to get the reminder")
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val text = runCatching { ctx.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } }.getOrNull()
            vm.onImportText(text ?: "", uri.lastPathSegment?.substringAfterLast('/') ?: "progress file")
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 24.dp, bottom = 120.dp)) {
        Text("Settings", Modifier.appear(0).semantics { heading() }, serif(32f, 300, 60f, line = 1.05f, tracking = -0.015f))
        Spacer(Modifier.height(22.dp))

        Column(Modifier.appear(40)) {
            GroupLabel("Daily reading", first = true)
            Group {
                Column(Modifier.padding(16.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                        Text("Length", style = sans(13.5f, 500))
                        Row(verticalAlignment = Alignment.Bottom) {
                            RollingText(Format.number(draft), serif(30f, 300, 48f, line = 1f, tracking = -0.01f), up = up)
                            Text(" words", Modifier.padding(bottom = 4.dp), sans(12f), p.ink3)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    GoldSlider(draft, 100, 1500, 25, { up = it > draft; draft = it }, ::commit, "Daily reading length in words")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        listOf("100", "500", "1,000", "1,500").forEach { Text(it, style = sans(10f), color = p.ink3) }
                    }
                    Spacer(Modifier.height(14.dp))
                    val presets = listOf(150, 300, 600)
                    Segmented(listOf("Short" to "150", "Standard" to "300", "Long" to "600"), presets.indexOf(draft),
                        { up = presets[it] > draft; draft = presets[it]; commit() })
                    Spacer(Modifier.height(14.dp))
                    Text("About ${Format.minutes(draft)} min a day · finish in ${finishText.removePrefix("about ")}", style = sans(12f))
                    Text("Readings end at the end of a sentence, usually at a paragraph break, and never go over this length.", Modifier.padding(top = 6.dp), sans(11.5f), p.ink3)
                    AnimatedVisibility(active != null && draft < active.words, enter = expandVertically(springy(0.8f, 400f)) + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                        Text("Today’s reading (${active?.words ?: 0} words) is longer than this, so it will be rebuilt to fit.",
                            Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.goldWash).padding(12.dp, 10.dp), sans(11.5f))
                    }
                }
                Item("Finish a passage first", "If a reading stops mid-story, tomorrow continues it") {
                    GoldSwitch(s.finishPassages, { v -> vm.update { it.copy(finishPassages = v) } }, "Finish a passage first")
                }
                Item("Verse numbers") { GoldSwitch(s.verseNumbers, { v -> vm.update { it.copy(verseNumbers = v) } }, "Verse numbers") }
            }
        }

        Column(Modifier.appear(90)) {
            GroupLabel("Reminder and appearance")
            Group {
                Item("Daily reminder", if (s.reminderOn) Format.time(s.reminderMinutes) else "Off", divider = false, onClick = if (s.reminderOn) ({
                    TimePickerDialog(ctx, { _, h, m -> vm.update { it.copy(reminderMinutes = h * 60 + m) } }, s.reminderMinutes / 60, s.reminderMinutes % 60, false).show()
                }) else null) {
                    GoldSwitch(s.reminderOn, { on ->
                        if (on && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else vm.update { it.copy(reminderOn = on) }
                    }, "Daily reminder")
                }
                Item("Text size") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("A−", Modifier.pressable { vm.update { x -> x.copy(textScale = (x.textScale - 0.1f).coerceAtLeast(0.8f)) } }.padding(10.dp), sans(14f, 600))
                        RollingText("${Math.round(s.textScale * 100)}%", sans(12.5f), color = p.ink3, up = true)
                        Text("A+", Modifier.pressable { vm.update { x -> x.copy(textScale = (x.textScale + 0.1f).coerceAtMost(1.6f)) } }.padding(10.dp), sans(17f, 600))
                    }
                }
                Item("Theme", onClick = { vm.update { it.copy(theme = ThemeMode.values()[(it.theme.ordinal + 1) % 3]) } }) {
                    RollingText(when (s.theme) { ThemeMode.SYSTEM -> "Automatic"; ThemeMode.LIGHT -> "Light"; ThemeMode.DARK -> "Dark" }, sans(12.5f), color = p.ink3, up = true)
                }
                Item("App icon", onClick = { vm.update { it.copy(lightIcon = !it.lightIcon) } }) {
                    RollingText(if (s.lightIcon) "Light" else "Ink", sans(12.5f), color = p.ink3, up = true)
                }
            }
        }

        Column(Modifier.appear(140)) {
            GroupLabel("Progress and backup")
            Group {
                Item("Export progress", "Save a file to open on another device", divider = false, onClick = { ctx.startActivity(vm.exportProgress() ?: return@Item) }) { PathIcon(Ic.UPLOAD, 17.dp, p.ink3, 1.8f) }
                Item("Import progress", "Combine with or replace this device’s progress", onClick = { picker.launch(arrayOf("application/json", "text/plain", "*/*")) }) { PathIcon(Ic.DOWNLOAD, 17.dp, p.ink3, 1.8f) }
                if (l.ctrl.snapshotAvailable()) Item("Restore previous progress", "Undo the last import or reset", onClick = { vm.restoreSnapshot() }) { PathIcon(Ic.SWAP, 17.dp, p.ink3, 1.8f) }
            }
            Text(if (st.lastExportAt > 0) "Last exported " + Format.fullDate(java.time.Instant.ofEpochMilli(st.lastExportAt).atZone(java.time.ZoneId.systemDefault()).toLocalDate()) else "Not exported yet",
                Modifier.padding(start = 4.dp, top = 10.dp), sans(11f), p.ink3)
        }

        Column(Modifier.appear(190)) {
            GroupLabel("Widget")
            Group {
                Item("Verse library", "${l.library.size} verses · updated October 2026", divider = false)
                Item("How to add the widget", onClick = { vm.sheet = Sheet.WidgetHelp }) { PathIcon(Ic.CHEVRON, 14.dp, p.ink3, 2f) }
            }
            GroupLabel("About")
            Group {
                Item("Sources and licenses", "World English Bible (public domain) · OpenBible.info (CC BY 4.0)", divider = false, onClick = { vm.push(Route.About) }) { PathIcon(Ic.CHEVRON, 14.dp, p.ink3, 2f) }
                Item("Reset progress", "Asks twice and saves a backup first", titleColor = p.danger, onClick = { vm.sheet = Sheet.ConfirmReset })
            }
        }
    }
}

@Composable
fun AboutScreen(vm: AppViewModel) {
    val p = C.p
    androidx.activity.compose.BackHandler { vm.pop() }
    Box(Modifier.fillMaxSize().background(p.app)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 64.dp, bottom = 60.dp)) {
            Text("Sources and licenses", Modifier.semantics { heading() }, serif(30f, 300, 60f, line = 1.1f, tracking = -0.015f))
            listOf(
                "Scripture" to "World English Bible (WEB), public domain. “World English Bible” is a trademark of eBible.org.",
                "Verse of the day" to "The selection uses data from OpenBible.info (Topical Bible), licensed under CC BY 4.0. Verse text always comes from the bundled WEB.",
                "Fonts" to "Newsreader and Instrument Sans, SIL Open Font License.",
                "Privacy" to "No accounts, no analytics, no network use. Your progress stays on this device unless you export it.",
            ).forEachIndexed { i, (h, b) ->
                Column(Modifier.padding(top = 26.dp).appear(i * 60)) { Eyebrow(h); Text(b, Modifier.padding(top = 8.dp), serif(16f, 400, 16f, line = 1.55f), p.ink2) }
            }
        }
        Box(Modifier.statusBarsPadding().padding(16.dp, 6.dp)) { CircleButton(Ic.BACK, "Back") { vm.pop() } }
    }
}
