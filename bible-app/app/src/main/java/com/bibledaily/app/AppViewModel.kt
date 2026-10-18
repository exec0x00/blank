package com.bibledaily.app

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.runtime.*
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.bibledaily.app.data.*
import com.bibledaily.app.domain.*
import com.bibledaily.app.reminder.Reminder
import com.bibledaily.app.widget.WidgetUpdater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

sealed interface Route {
    data object Reader : Route
    data object ExtraReader : Route
    data class Browse(val chapter: Int) : Route
    data class Done(val completion: Completion, val extra: Boolean) : Route
    data class BookDetail(val book: Int) : Route
    data object AllBooks : Route
    data object About : Route
    data object Finished : Route
}

enum class Tab { Today, Progress, Settings }

sealed interface Sheet {
    data class Verse(val verse: LibraryVerse) : Sheet
    data class Import(val file: ImportFile, val name: String) : Sheet
    data object WidgetHelp : Sheet
    data object ConfirmReset : Sheet
    data object Chooser : Sheet
}

class Loaded(val bible: Bible, val library: List<LibraryVerse>, val ctrl: AppController, val backup: Backup)

class AppViewModel(private val app: Application) : AndroidViewModel(app) {
    var loaded by mutableStateOf<Loaded?>(null)
        private set

    var tab by mutableStateOf(Tab.Today)
    val stack = mutableStateListOf<Route>()
    var sheet by mutableStateOf<Sheet?>(null)
    var toastTitle by mutableStateOf<String?>(null)
    var toastDetail by mutableStateOf<String?>(null)
    var importError by mutableStateOf<String?>(null)
    private var toastJob: kotlinx.coroutines.Job? = null

    /** Which way the last tab change went, for the slide direction. */
    var tabDirection by mutableIntStateOf(1)
        private set

    init {
        viewModelScope.launch {
            val l = withContext(Dispatchers.Default) {
                val a = app.assets
                val bible = a.open("bible.txt").use { b -> a.open("books.txt").use { k -> Bible.load(b, k) } }
                val lib = VerseOfDay.parse(a.open("library.json").bufferedReader().use { it.readText() })
                val manifest = a.open("manifest.json").bufferedReader().use { org.json.JSONObject(it.readText()) }
                val ctrl = AppController(bible, lib, FileStorage(app))
                ctrl.onChanged = { st ->
                    Mirror.write(app, bible, st)
                    WidgetUpdater.refresh(app)
                    Reminder.schedule(app, st.settings)
                }
                Mirror.write(app, bible, ctrl.s)
                Loaded(bible, lib, ctrl, Backup(bible, manifest.getString("textVersion")))
            }
            loaded = l
            WidgetUpdater.scheduleMidnight(app)
            Reminder.schedule(app, l.ctrl.s.settings)
        }
    }

    val current: Route? get() = stack.lastOrNull()

    fun push(r: Route) { stack.add(r) }
    fun pop(): Boolean { if (stack.isEmpty()) return false; stack.removeAt(stack.lastIndex); return true }
    fun replaceTop(r: Route) { if (stack.isNotEmpty()) stack[stack.lastIndex] = r else stack.add(r) }

    fun selectTab(t: Tab) {
        if (stack.isNotEmpty()) stack.clear()
        if (t == tab) return
        tabDirection = if (t.ordinal > tab.ordinal) 1 else -1
        tab = t
    }

    fun toast(title: String, detail: String? = null) {
        toastTitle = title; toastDetail = detail
        toastJob?.cancel()
        toastJob = viewModelScope.launch { kotlinx.coroutines.delay(2600); toastTitle = null }
    }

    /** Called when the app returns to the foreground or the date may have changed. */
    fun refreshDay() { loaded?.ctrl?.ensureToday() }

    // ------------------------------------------------------------ reading

    fun beginReading() {
        val l = loaded ?: return
        if (l.ctrl.s.today?.status == ReadingStatus.ACTIVE) push(Route.Reader)
    }

    fun markRead(extra: Boolean) {
        val l = loaded ?: return
        val c = (if (extra) l.ctrl.markExtraRead() else l.ctrl.markRead()) ?: return
        replaceTop(Route.Done(c, extra))
    }

    fun readAnother() {
        val l = loaded ?: return
        if (l.ctrl.startExtra() != null) replaceTop(Route.ExtraReader) else if (l.ctrl.finished) replaceTop(Route.Finished)
    }

    fun swap(): Boolean = loaded?.ctrl?.swap() ?: false

    fun openChapter(chapterIdx: Int) = push(Route.Browse(chapterIdx))

    fun openVerseOfDay() {
        val l = loaded ?: return
        sheet = Sheet.Verse(verseOfToday(l))
    }

    fun verseOfToday(l: Loaded = loaded!!): LibraryVerse =
        VerseOfDay.forDate(l.library, l.ctrl.s.installSeed, l.ctrl.s.installEpochDay, l.ctrl.clock.today())

    // ------------------------------------------------------------ settings

    fun setLimit(words: Int) { loaded?.ctrl?.setDailyWords(words) }

    fun update(f: (Settings) -> Settings) {
        val l = loaded ?: return
        val before = l.ctrl.s.settings
        l.ctrl.updateSettings(f)
        val after = l.ctrl.s.settings
        if (before.lightIcon != after.lightIcon) setLauncherIcon(after.lightIcon)
    }

    private fun setLauncherIcon(light: Boolean) {
        val pm = app.packageManager
        fun set(name: String, on: Boolean) = pm.setComponentEnabledSetting(
            ComponentName(app, "com.bibledaily.app.$name"),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
        set("LauncherLight", light); set("LauncherDark", !light)
    }

    // ------------------------------------------------------------ backup

    fun exportProgress(): Intent? {
        val l = loaded ?: return null
        val now = System.currentTimeMillis()
        val date = l.ctrl.clock.today().toString()
        val text = l.backup.export(l.ctrl.s, android.os.Build.MODEL ?: "Android", now)
        val dir = File(app.cacheDir, "exports").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, l.backup.fileName(date)).apply { writeText(text) }
        val uri: Uri = FileProvider.getUriForFile(app, "${app.packageName}.files", f)
        l.ctrl.markExported(now)
        toast("Progress exported", f.name)
        return Intent.createChooser(
            Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Export progress",
        )
    }

    fun onImportText(text: String, name: String) {
        val l = loaded ?: return
        when (val r = l.backup.parse(text)) {
            is ParseResult.Ok -> { importError = null; sheet = Sheet.Import(r.file, name) }
            is ParseResult.Error -> { importError = r.error.message; sheet = Sheet.Chooser }
        }
    }

    fun confirmImport(file: ImportFile, mode: ImportMode) {
        val l = loaded ?: return
        val next = l.backup.apply(l.ctrl.s, file, mode)
        l.ctrl.applyImported(next)
        if (mode == ImportMode.COMBINE) l.ctrl.rebuildAfterProgressChange()
        sheet = null
        toast("Progress imported", "Use Restore previous progress in Settings to undo")
    }

    fun restoreSnapshot() {
        val l = loaded ?: return
        if (l.ctrl.restoreSnapshot()) toast("Previous progress restored")
    }

    fun reset() {
        loaded?.ctrl?.resetProgress()
        sheet = null
        stack.clear()
        toast("Progress reset", "A backup was saved. You can restore it in Settings")
    }

    fun startNewRound() {
        loaded?.ctrl?.startNewRound()
        stack.clear(); tab = Tab.Today
    }
}
