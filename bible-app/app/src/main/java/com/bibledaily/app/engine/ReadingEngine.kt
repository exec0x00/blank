package com.bibledaily.app.engine

import com.bibledaily.app.data.Bible
import java.util.BitSet
import java.util.Random

/** One run of consecutive verses (indices, inclusive) inside a reading. */
data class Passage(val first: Int, val last: Int, val words: Int)

/** The outcome of building a reading. [continuation] is the verse where the passage carries on, or -1. */
data class BuiltReading(
    val passages: List<Passage>,
    val continuation: Int,
    val forcedContinuation: Boolean,
) {
    val words get() = passages.sumOf { it.words }
}

/**
 * Picks and builds readings. Pure logic (no Android types), so it can be tested on the JVM.
 *
 * Rules (plan §8): a reading is made of whole sentences, starts only where a chapter begins or
 * where an earlier reading stopped, never contains a read verse, and never exceeds the limit.
 */
class ReadingEngine(private val bible: Bible) {

    private class Bound(val last: Int, val words: Int, val paraEnd: Boolean, val chapterEnd: Boolean)
    private class Fill(val last: Int, val words: Int, val midParagraph: Boolean, val forcedSplit: Boolean)

    /** Unread verses that begin a chapter or follow a read verse. */
    fun startPoints(read: BitSet): IntArray {
        val out = ArrayList<Int>(2048)
        var v = read.nextClearBit(0)
        while (v < bible.verseCount) {
            if (bible.isChapterStart(v) || read.get(v - 1)) out += v
            v = read.nextClearBit(v + 1)
        }
        return out.toIntArray()
    }

    /**
     * Builds a reading of at most [limit] words.
     *
     * @param continuation verse to carry on from (the previous reading's stopping point), or -1
     * @param startAt force the first passage to start at this verse (used to rebuild a reading that is now too long)
     * @param avoidStart do not start at this verse if any other start point exists
     * @param reserved verses held back for another reading (treated as read while picking)
     * @return null when nothing is left to read
     */
    fun build(
        limit: Int,
        read: BitSet,
        rnd: Random,
        continuation: Int = -1,
        startAt: Int = -1,
        avoidStart: Int = -1,
        reserved: BitSet? = null,
    ): BuiltReading? {
        require(limit >= MIN_LIMIT) { "limit must be at least $MIN_LIMIT" }
        val work = read.clone() as BitSet
        if (reserved != null) work.or(reserved)
        val passages = ArrayList<Passage>(3)
        var budget = limit
        var cont = -1
        var forced = false

        for (attempt in 0 until MAX_PASSAGES) {
            val firstPassage = passages.isEmpty()
            var fill: Fill? = null
            var start = -1
            if (firstPassage) {
                start = when {
                    startAt in 0 until bible.verseCount && !work.get(startAt) -> startAt
                    continuation in 0 until bible.verseCount && !work.get(continuation) -> continuation
                    else -> pickStart(work, rnd, avoidStart)
                }
                if (start < 0) return null
                fill = fill(start, budget, limit, work)
            } else {
                // Bundling: try a few random start points for a passage that fits what is left.
                var tries = 0
                while (fill == null && tries++ < 24) {
                    start = pickStart(work, rnd, -1)
                    if (start < 0) break
                    fill = fill(start, budget, budget, work)
                }
                if (fill == null) break
            }
            if (fill == null) {
                if (firstPassage) return null
                break
            }
            passages += Passage(start, fill.last, fill.words)
            work.set(start, fill.last + 1)
            budget -= fill.words

            if (fill.forcedSplit) {
                cont = fill.last + 1
                forced = true
                break
            }
            if (fill.midParagraph) {
                val next = fill.last + 1
                if (next < bible.verseCount && !work.get(next) &&
                    bible.bookOfVerse[next] == bible.bookOfVerse[fill.last]
                ) {
                    cont = next
                    break
                }
            }
            if (limit - budget >= (limit + 1) / 2) break
        }
        if (passages.isEmpty()) return null
        return BuiltReading(passages, cont, forced)
    }

    private fun pickStart(work: BitSet, rnd: Random, avoid: Int): Int {
        val pts = startPoints(work)
        if (pts.isEmpty()) return -1
        if (pts.size == 1) return pts[0]
        while (true) {
            val v = pts[rnd.nextInt(pts.size)]
            if (v != avoid) return v
        }
    }

    /**
     * Fills forward from [start] with whole units under [cap] words, then chooses the strongest
     * natural break that keeps at least half of [halfBase].
     */
    private fun fill(start: Int, cap: Int, halfBase: Int, work: BitSet): Fill? {
        val bounds = ArrayList<Bound>(32)
        val book = bible.bookOfVerse[start]
        val startChapter = bible.chapterOfVerse[start]
        var u = bible.unitOfVerse[start]
        var first = start
        var words = 0
        while (true) {
            var lastV = bible.unitLast[u]
            var partial = false
            val firstRead = work.nextSetBit(first)
            if (firstRead in first..lastV) { lastV = firstRead - 1; partial = true }
            if (lastV < first) break
            val w = bible.wordsBetween(first, lastV)
            if (words + w > cap) break
            words += w
            bounds += Bound(
                lastV, words,
                paraEnd = !partial && bible.unitParaEnd[u],
                chapterEnd = !partial && bible.isChapterEnd(lastV),
            )
            if (partial) break
            u++
            if (u >= bible.unitCount) break
            first = bible.unitFirst[u]
            if (bible.bookOfVerse[first] != book) break
            val fr = work.nextSetBit(first)
            if (fr in first..bible.unitLast[u]) break
        }

        if (bounds.isEmpty()) return splitOversize(start, cap, halfBase, work)

        val lastB = bounds.last()
        var chosen = lastB
        val crossed = bible.chapterOfVerse[lastB.last] != startChapter
        if (crossed && !lastB.chapterEnd) {
            val ce = bounds.lastOrNull { it.chapterEnd }
            if (ce != null && ce !== lastB && ce.words * 2 >= halfBase) chosen = ce
        }
        if (chosen === lastB && !lastB.paraEnd) {
            val pe = bounds.lastOrNull { it.paraEnd }
            if (pe != null && pe !== lastB && pe.words * 2 >= halfBase) chosen = pe
        }
        // The passage "continues" when the fill ran out inside a paragraph (even if we stepped back to
        // an earlier break to stay tidy), unless we stopped at a chapter end.
        return Fill(chosen.last, chosen.words, midParagraph = !lastB.paraEnd && !chosen.chapterEnd, forcedSplit = false)
    }

    /**
     * The one exception (plan §8.4): a single sentence longer than the cap is split *between verses*,
     * preferring a verse that ends in ; or :, then a comma. The rest becomes a forced continuation.
     */
    private fun splitOversize(start: Int, cap: Int, halfBase: Int, work: BitSet): Fill? {
        val unitEnd = bible.unitLast[bible.unitOfVerse[start]]
        var cum = 0
        var bestStrong = -1
        var strongWords = 0
        var bestComma = -1
        var commaWords = 0
        var bestAny = -1
        var anyWords = 0
        var v = start
        while (v <= unitEnd && !work.get(v)) {
            cum += bible.words[v]
            if (cum > cap) break
            val t = bible.texts[v].trimEnd()
            val atLeastHalf = cum * 2 >= halfBase
            if (t.endsWith(";") || t.endsWith(":")) { if (atLeastHalf) { bestStrong = v; strongWords = cum } }
            else if (t.endsWith(",")) { if (atLeastHalf) { bestComma = v; commaWords = cum } }
            bestAny = v; anyWords = cum
            v++
        }
        return when {
            bestStrong >= 0 -> Fill(bestStrong, strongWords, midParagraph = true, forcedSplit = true)
            bestComma >= 0 -> Fill(bestComma, commaWords, midParagraph = true, forcedSplit = true)
            bestAny >= 0 -> Fill(bestAny, anyWords, midParagraph = true, forcedSplit = true)
            else -> null
        }
    }

    companion object {
        const val MIN_LIMIT = 100
        const val MAX_LIMIT = 1500
        const val MAX_PASSAGES = 3
    }
}
