package com.bibledaily.app.domain

import com.bibledaily.app.data.Bible
import com.bibledaily.app.engine.Passage
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

object Format {
    private const val EN = "–"

    /** "Luke 15:11–21", "Luke 15:22–16:2", "Psalm 23:1" (book name only; Psalms keep the plural name). */
    fun ref(bible: Bible, first: Int, last: Int): String {
        val b = bible.book(first)
        val c1 = bible.chapterNumber(first)
        val v1 = bible.verseNumber(first)
        val c2 = bible.chapterNumber(last)
        val v2 = bible.verseNumber(last)
        val name = if (b.code == "PSA") "Psalm" else b.name
        return when {
            first == last -> "$name $c1:$v1"
            c1 == c2 -> "$name $c1:$v1$EN$v2"
            else -> "$name $c1:$v1$EN$c2:$v2"
        }
    }

    fun ref(bible: Bible, p: Passage) = ref(bible, p.first, p.last)

    fun refs(bible: Bible, passages: List<Passage>) = passages.joinToString(" · ") { ref(bible, it) }

    /** "Verses 11–21" for the reader heading. */
    fun verses(bible: Bible, p: Passage): String {
        val c1 = bible.chapterNumber(p.first); val c2 = bible.chapterNumber(p.last)
        val v1 = bible.verseNumber(p.first); val v2 = bible.verseNumber(p.last)
        return when {
            p.first == p.last -> "Verse $v1"
            c1 == c2 -> "Verses $v1$EN$v2"
            else -> "$c1:$v1$EN$c2:$v2"
        }
    }

    /** Speech-friendly: "Luke chapter 15, verses 11 to 21". */
    fun spokenRef(bible: Bible, p: Passage): String {
        val b = bible.book(p.first)
        val c1 = bible.chapterNumber(p.first); val c2 = bible.chapterNumber(p.last)
        val v1 = bible.verseNumber(p.first); val v2 = bible.verseNumber(p.last)
        return when {
            p.first == p.last -> "${b.name} chapter $c1, verse $v1"
            c1 == c2 -> "${b.name} chapter $c1, verses $v1 to $v2"
            else -> "${b.name} chapter $c1 verse $v1 to chapter $c2 verse $v2"
        }
    }

    fun minutes(words: Int) = max(1, (words / 150.0).roundToInt())

    fun minutesText(words: Int) = "about ${minutes(words)} min"

    fun number(n: Int): String = String.format(Locale.US, "%,d", n)

    fun percent(part: Int, whole: Int, decimals: Int = 1): String =
        if (whole == 0) "0" else String.format(Locale.US, "%.${decimals}f", part * 100.0 / whole)

    /** One decimal place, two below 1 %. */
    fun progressPercent(part: Int, whole: Int): String {
        val v = if (whole == 0) 0.0 else part * 100.0 / whole
        return String.format(Locale.US, if (v in 0.0001..0.9999) "%.2f" else "%.1f", v)
    }

    fun finishText(remainingWords: Int, limit: Int, fill: Double): String {
        if (remainingWords <= 0) return "finished"
        val days = remainingWords / (limit * fill)
        return when {
            days < 60 -> "about ${max(1, (days / 7).roundToInt())} weeks"
            days < 730 -> "about ${(days / 30.4).roundToInt()} months"
            else -> "about ${String.format(Locale.US, "%.1f", days / 365.25)} years"
        }
    }

    private val longDate = DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.ENGLISH)
    private val shortDate = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
    private val widgetDate = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)
    private val fullDate = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH)
    private val monthYear = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)

    fun longDate(d: LocalDate): String = d.format(longDate)
    fun shortDate(d: LocalDate): String = d.format(shortDate)
    fun widgetDate(d: LocalDate): String = d.format(widgetDate)
    fun fullDate(d: LocalDate): String = d.format(fullDate)
    fun monthYear(d: LocalDate): String = d.format(monthYear)

    fun time(minutes: Int): String {
        val h = minutes / 60; val m = minutes % 60
        val suffix = if (h < 12) "AM" else "PM"
        val h12 = if (h % 12 == 0) 12 else h % 12
        return String.format(Locale.US, "%d:%02d %s", h12, m, suffix)
    }
}
