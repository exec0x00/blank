package com.bibledaily.app.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.*
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.color.ColorProvider
import com.bibledaily.app.MainActivity
import com.bibledaily.app.domain.Format
import com.bibledaily.app.domain.LibraryVerse
import com.bibledaily.app.domain.Mirror
import com.bibledaily.app.domain.VerseOfDay
import java.time.LocalDate

private val SMALL = DpSize(110.dp, 110.dp)
private val MEDIUM = DpSize(250.dp, 110.dp)
private val LARGE = DpSize(250.dp, 250.dp)

private fun cp(day: Long, night: Long) = ColorProvider(day = Color(day.toInt()), night = Color(night.toInt()))
private val BG = cp(0xF2FAFAF7, 0xE617181C)
private val INK = cp(0xFF14161A, 0xFFF1EEE7)
private val MUTED = cp(0xFF8D9199, 0xFF7F848D)
private val GOLD = cp(0xFF87601A, 0xFFDDB66C)
private val HAIR = cp(0x1F14161A, 0x1FFFFFFF)

class WidgetData(val verse: LibraryVerse?, val date: LocalDate, val readingRef: String, val readingMeta: String, val done: Boolean)

object WidgetDataLoader {
    @Volatile private var cache: List<LibraryVerse>? = null

    fun load(ctx: Context): WidgetData {
        val lib = cache ?: runCatching {
            VerseOfDay.parse(ctx.assets.open("library.json").bufferedReader().use { it.readText() })
        }.getOrDefault(emptyList()).also { cache = it }
        val m = Mirror.prefs(ctx)
        val today = LocalDate.now()
        val verse = if (lib.isEmpty()) null else VerseOfDay.forDate(lib, m.getLong("seed", 0L), m.getLong("installDay", today.toEpochDay()), today)
        return WidgetData(verse, today, m.getString("readingRef", "") ?: "", m.getString("readingMeta", "") ?: "", m.getBoolean("doneToday", false))
    }
}

class BibleWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM, LARGE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val data = WidgetDataLoader.load(context)
        provideContent { GlanceTheme { Content(data) } }
    }

    @Composable
    private fun Content(d: WidgetData) {
        val size = LocalSize.current
        val v = d.verse
        val open = actionStartActivity<MainActivity>(actionParametersOf(ActionParameters.Key<Boolean>("open_verse") to true))
        Box(
            GlanceModifier.fillMaxSize().background(BG).cornerRadius(24.dp).clickable(open).padding(if (size.height >= 200.dp) 20.dp else 14.dp),
        ) {
            if (v == null) { Text("Open Bible to set up your verse of the day.", style = TextStyle(color = INK, fontSize = 13.sp)); return@Box }
            when {
                size.height >= 200.dp -> Large(d, v)
                size.width >= 200.dp -> Medium(d, v)
                else -> Small(v)
            }
        }
    }

    @Composable
    private fun Eyebrow(text: String) =
        Text(text.uppercase(), style = TextStyle(color = MUTED, fontSize = 9.sp, fontWeight = FontWeight.Bold))

    /** The whole verse if it is short enough; otherwise its first complete sentence and an ellipsis. */
    private fun fit(v: LibraryVerse, maxChars: Int): String =
        if (v.text.length <= maxChars) v.text else v.sentence.trimEnd() + " …"

    @Composable
    private fun Small(v: LibraryVerse) {
        val t = fit(v, 92)
        Column(GlanceModifier.fillMaxSize()) {
            Eyebrow("Today")
            Spacer(GlanceModifier.height(8.dp))
            Text(t, GlanceModifier.defaultWeight(), style = TextStyle(color = INK, fontSize = if (t.length > 70) 13.sp else 14.sp, fontFamily = FontFamily.Serif), maxLines = 6)
            Text(v.ref, style = TextStyle(color = GOLD, fontSize = 10.5.sp, fontWeight = FontWeight.Bold))
        }
    }

    @Composable
    private fun Medium(d: WidgetData, v: LibraryVerse) {
        val t = fit(v, 230)
        Column(GlanceModifier.fillMaxSize()) {
            Eyebrow("Verse of the day")
            Spacer(GlanceModifier.height(8.dp))
            Text(t, GlanceModifier.defaultWeight(), style = TextStyle(color = INK, fontSize = if (t.length > 170) 12.sp else 13.sp, fontFamily = FontFamily.Serif), maxLines = 6)
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(v.ref, GlanceModifier.defaultWeight(), style = TextStyle(color = GOLD, fontSize = 10.5.sp, fontWeight = FontWeight.Bold))
                Text(Format.widgetDate(d.date), style = TextStyle(color = MUTED, fontSize = 10.sp))
            }
        }
    }

    @Composable
    private fun Large(d: WidgetData, v: LibraryVerse) {
        Column(GlanceModifier.fillMaxSize()) {
            Eyebrow("Verse of the day · " + Format.widgetDate(d.date))
            Spacer(GlanceModifier.height(14.dp))
            Text(v.text, GlanceModifier.defaultWeight(), style = TextStyle(color = INK, fontSize = if (v.text.length > 170) 16.sp else 19.sp, fontFamily = FontFamily.Serif), maxLines = 9)
            Text(v.ref, style = TextStyle(color = GOLD, fontSize = 11.5.sp, fontWeight = FontWeight.Bold))
            Spacer(GlanceModifier.height(12.dp))
            Box(GlanceModifier.fillMaxWidth().height(1.dp).background(HAIR)) {}
            Spacer(GlanceModifier.height(10.dp))
            Eyebrow(if (d.done) "Read for today" else "Today’s reading")
            if (d.readingRef.isNotEmpty()) {
                Text(d.readingRef, style = TextStyle(color = INK, fontSize = 16.sp, fontFamily = FontFamily.Serif), maxLines = 1)
                Text(d.readingMeta, style = TextStyle(color = MUTED, fontSize = 11.sp), maxLines = 1)
            }
        }
    }
}

class BibleWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BibleWidget()
}
