package com.bibledaily.app.domain

import com.bibledaily.app.data.Bible
import com.bibledaily.app.data.Reading
import com.bibledaily.app.data.ReadingStatus
import com.bibledaily.app.data.UserState
import java.time.LocalDate
import java.util.BitSet

data class BookProgress(val bookIndex: Int, val readWords: Int, val totalWords: Int) {
    val fraction get() = if (totalWords == 0) 0f else readWords.toFloat() / totalWords
}

data class ProgressStats(
    val wordsRead: Int,
    val totalWords: Int,
    val otRead: Int,
    val ntRead: Int,
    val books: List<BookProgress>,
    val readings: Int,
    val chaptersStarted: Int,
    val chaptersFinished: Int,
    val streak: Int,
    val longestStreak: Int,
    val finishText: String,
    val closest: List<BookProgress>,
) {
    val fraction get() = if (totalWords == 0) 0f else wordsRead.toFloat() / totalWords
}

object Stats {
    const val DEFAULT_FILL = 0.82

    private fun doneDates(history: List<Reading>): Set<LocalDate> =
        history.filter { it.status == ReadingStatus.DONE && !it.extra }
            .mapNotNull { runCatching { LocalDate.parse(it.date) }.getOrNull() }.toSet()

    fun currentStreak(history: List<Reading>, today: LocalDate): Int {
        val dates = doneDates(history)
        var d = if (today in dates) today else today.minusDays(1)
        var n = 0
        while (d in dates) { n++; d = d.minusDays(1) }
        return n
    }

    fun longestStreak(history: List<Reading>): Int {
        val dates = doneDates(history).sorted()
        var best = 0; var run = 0; var prev: LocalDate? = null
        for (d in dates) {
            run = if (prev != null && prev.plusDays(1) == d) run + 1 else 1
            if (run > best) best = run
            prev = d
        }
        return best
    }

    /** Average share of the limit that a day's reading actually fills, from the user's own history. */
    fun averageFill(history: List<Reading>): Double {
        val recent = history.filter { !it.extra && it.limit > 0 }.takeLast(60)
        if (recent.size < 5) return DEFAULT_FILL
        return recent.sumOf { it.words.toDouble() / it.limit }.div(recent.size).coerceIn(0.4, 1.0)
    }

    fun perBook(bible: Bible, read: BitSet): IntArray {
        val out = IntArray(bible.books.size)
        var v = read.nextSetBit(0)
        while (v >= 0 && v < bible.verseCount) {
            out[bible.bookOfVerse[v] - 1] += bible.words[v]
            v = read.nextSetBit(v + 1)
        }
        return out
    }

    fun compute(bible: Bible, st: UserState, today: LocalDate, limit: Int = st.settings.dailyWords): ProgressStats {
        val per = perBook(bible, st.read)
        val books = bible.books.mapIndexed { i, b -> BookProgress(b.index, per[i], b.words) }
        var started = 0; var finished = 0
        for (c in bible.chapters) {
            val nr = st.read.nextSetBit(c.firstVerse)
            if (nr in c.firstVerse..c.lastVerse) {
                started++
                if (st.read.nextClearBit(c.firstVerse) > c.lastVerse) finished++
            }
        }
        val wordsRead = per.sum()
        val ot = per.take(39).sum()
        return ProgressStats(
            wordsRead = wordsRead, totalWords = bible.totalWords, otRead = ot, ntRead = wordsRead - ot,
            books = books, readings = st.history.size, chaptersStarted = started, chaptersFinished = finished,
            streak = currentStreak(st.history, today), longestStreak = longestStreak(st.history),
            finishText = Format.finishText(bible.totalWords - wordsRead, limit, averageFill(st.history)),
            closest = books.filter { it.readWords > 0 }.sortedByDescending { it.fraction }.take(4),
        )
    }
}
