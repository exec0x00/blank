package com.bibledaily.app.ui

import android.appwidget.AppWidgetManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.bibledaily.app.*
import com.bibledaily.app.domain.*
import com.bibledaily.app.widget.BibleWidgetReceiver
import java.time.LocalDate

@Composable
fun Sheets(vm: AppViewModel, l: Loaded) {
    val sheet = vm.sheet
    var last by remember { mutableStateOf<Sheet?>(null) }
    if (sheet != null) last = sheet
    BottomSheet(visible = sheet != null, onDismiss = { vm.sheet = null }) {
        when (val s = last) {
            is Sheet.Verse -> VerseSheet(vm, l, s.verse)
            is Sheet.Import -> ImportSheet(vm, l, s)
            Sheet.WidgetHelp -> WidgetHelpSheet(vm)
            Sheet.ConfirmReset -> ResetSheet(vm)
            Sheet.Chooser -> ImportErrorSheet(vm)
            null -> {}
        }
    }
}

@Composable
private fun SheetTitle(t: String) = Text(t, Modifier.padding(bottom = 4.dp), serif(26f, 300, 48f, line = 1.1f, tracking = -0.015f))

@Composable
private fun VerseSheet(vm: AppViewModel, l: Loaded, v: LibraryVerse) {
    val p = C.p
    val ctx = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { kotlinx.coroutines.delay(1600); copied = false } }
    Eyebrow("Verse of the day")
    Text(v.text, Modifier.padding(top = 14.dp, bottom = 12.dp), serif(22f, 400, 24f, line = 1.45f))
    Text(v.ref, Modifier.padding(bottom = 22.dp), sans(12.5f, 600, tracking = 0.2f), p.goldInk)
    val idx = l.bible.indexOfId(v.firstId)
    if (idx >= 0) AppButton("Read the whole chapter", { vm.sheet = null; vm.openChapter(l.bible.chapterOfVerse[idx]) })
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f)) {
            AppButton("Share", {
                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "“${v.text}” — ${v.ref} (WEB)"), "Share verse"))
            }, kind = BtnKind.Ghost, leading = { PathIcon(Ic.SHARE, 16.dp, p.ink, 1.8f) })
        }
        Box(Modifier.weight(1f)) {
            AppButton(if (copied) "Copied" else "Copy", {
                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Verse", "“${v.text}” — ${v.ref} (WEB)"))
                copied = true
            }, kind = BtnKind.Ghost, leading = { AnimatedContent(copied, transitionSpec = { (scaleIn(spring(0.6f, 500f)) + fadeIn()) togetherWith (scaleOut() + fadeOut()) }, label = "copy") { c ->
                if (c) PathIcon(Ic.CHECK, 16.dp, p.gold, 2.2f) else PathIcon(Ic.COPY, 16.dp, p.ink, 1.8f) } })
        }
    }
}

@Composable
private fun Stat(label: String, pct: String, readings: String, last: String, modifier: Modifier) {
    val p = C.p
    Column(modifier.padding(12.dp, 12.dp)) {
        Eyebrow(label)
        Text(pct, Modifier.padding(top = 6.dp, bottom = 2.dp), serif(26f, 300, 48f, line = 1f))
        Text(readings, style = sans(11f), color = p.ink3); Text(last, style = sans(11f), color = p.ink3)
    }
}

@Composable
private fun ImportSheet(vm: AppViewModel, l: Loaded, s: Sheet.Import) {
    val p = C.p
    val st = l.ctrl.s
    var mode by remember(s) { mutableStateOf(ImportMode.COMBINE) }
    val total = l.bible.totalWords
    val combined = remember(s) { val b = st.read.clone() as java.util.BitSet; b.or(s.file.read); l.ctrl.codec.wordsIn(b) }
    fun lastRead(h: List<com.bibledaily.app.data.Reading>) = h.maxOfOrNull { it.date }?.let { runCatching { "Last read " + Format.shortDate(LocalDate.parse(it)) }.getOrNull() } ?: "No readings yet"
    SheetTitle("Import progress?")
    Row(Modifier.padding(top = 8.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        PathIcon(Ic.FILE, 26.dp, p.ink2, 1.5f)
        Column(Modifier.padding(start = 10.dp)) {
            Text(s.name, style = sans(11.5f, 500), color = p.ink2)
            Text("From ${s.file.deviceLabel}", style = sans(11.5f), color = p.ink3)
        }
    }
    Row(Modifier.fillMaxWidth().padding(bottom = 14.dp).clip(RoundedCornerShape(16.dp)).background(p.surface).border(1.dp, p.hair, RoundedCornerShape(16.dp))) {
        Stat("In the file", Format.progressPercent(s.file.wordsRead, total) + "%", "${s.file.history.size} readings", lastRead(s.file.history), Modifier.weight(1f))
        Box(Modifier.width(1.dp).height(100.dp).background(p.hair))
        Stat("This device", Format.progressPercent(st.wordsRead, total) + "%", "${st.history.size} readings", lastRead(st.history), Modifier.weight(1f))
    }
    @Composable fun Choice(m: ImportMode, title: String, body: String) {
        val on = mode == m
        val ring by animateDpAsState(if (on) 5.5.dp else 1.5.dp, springy(0.7f, 500f), label = "r")
        val border by animateColorAsState(if (on) p.ink else p.hair, motion(180), label = "b")
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).pressable(pressedScale = 0.985f, role = Role.RadioButton) { mode = m }
            .clip(RoundedCornerShape(16.dp)).background(p.surface).border(if (on) 1.5.dp else 1.dp, border, RoundedCornerShape(16.dp)).padding(14.dp, 12.dp)) {
            Box(Modifier.padding(top = 1.dp).size(18.dp).border(ring, if (on) p.ink else p.hair2, CircleShape))
            Column(Modifier.padding(start = 12.dp)) { Text(title, style = sans(12.5f, 600)); Text(body, Modifier.padding(top = 2.dp), sans(11.5f), p.ink3) }
        }
    }
    Choice(ImportMode.COMBINE, "Combine both", "Keeps everything read on either device. You’ll be at ${Format.progressPercent(combined, total)}%.")
    Choice(ImportMode.REPLACE, "Replace this device’s progress", "Uses only the file. Current progress is saved, so you can undo.")
    Spacer(Modifier.height(4.dp))
    AppButton("Import progress", { vm.confirmImport(s.file, mode) })
    AppButton("Cancel", { vm.sheet = null }, kind = BtnKind.Link)
}

@Composable
private fun ImportErrorSheet(vm: AppViewModel) {
    val p = C.p
    SheetTitle("Can’t import this file")
    Text(vm.importError ?: "", Modifier.padding(top = 8.dp, bottom = 22.dp), serif(16f, 400, 16f, line = 1.5f), p.ink2)
    AppButton("OK", { vm.sheet = null })
}

@Composable
private fun ResetSheet(vm: AppViewModel) {
    val p = C.p
    var step by remember { mutableIntStateOf(0) }
    AnimatedContent(step, transitionSpec = { (slideInHorizontally(tween(260)) { it / 3 } + fadeIn(tween(220))) togetherWith (slideOutHorizontally(tween(200)) { -it / 3 } + fadeOut(tween(140))) }, label = "reset") { s ->
        Column {
            if (s == 0) {
                SheetTitle("Reset progress?")
                Text("This clears everything you’ve read and your history. Your settings stay.", Modifier.padding(top = 8.dp, bottom = 22.dp), serif(16f, 400, 16f, line = 1.5f), p.ink2)
                AppButton("Continue", { step = 1 })
            } else {
                SheetTitle("Are you sure?")
                Text("A backup is saved first, so you can restore it from Settings for the next 30 days.", Modifier.padding(top = 8.dp, bottom = 22.dp), serif(16f, 400, 16f, line = 1.5f), p.ink2)
                Row(Modifier.fillMaxWidth().height(50.dp).pressable(onClick = { vm.reset() }).clip(RoundedCornerShape(16.dp)).background(p.danger), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Text("Reset progress", style = sans(14.5f, 600), color = androidx.compose.ui.graphics.Color.White)
                }
            }
            AppButton("Cancel", { vm.sheet = null }, kind = BtnKind.Link)
        }
    }
}

@Composable
private fun WidgetHelpSheet(vm: AppViewModel) {
    val p = C.p
    val ctx = LocalContext.current
    SheetTitle("Add the widget")
    listOf("Touch and hold an empty spot on your home screen.", "Tap Widgets, then find Bible.", "Drag the verse of the day onto your home screen. Resize it for more room, and a large one also shows today’s reading.")
        .forEachIndexed { i, t ->
            Row(Modifier.padding(top = 14.dp)) {
                Text("${i + 1}", Modifier.width(26.dp), serif(18f, 400, 18f), p.goldInk)
                Text(t, style = serif(16f, 400, 16f, line = 1.45f), color = p.ink2)
            }
        }
    Spacer(Modifier.height(22.dp))
    val mgr = AppWidgetManager.getInstance(ctx)
    if (mgr.isRequestPinAppWidgetSupported) AppButton("Add to home screen", { mgr.requestPinAppWidget(ComponentName(ctx, BibleWidgetReceiver::class.java), null, null); vm.sheet = null })
    AppButton("Done", { vm.sheet = null }, kind = if (mgr.isRequestPinAppWidgetSupported) BtnKind.Link else BtnKind.Ink)
}
