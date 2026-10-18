package com.bibledaily.app

import com.bibledaily.app.TestData.bible
import com.bibledaily.app.TestData.idx
import com.bibledaily.app.domain.Format
import com.bibledaily.app.engine.BuiltReading
import com.bibledaily.app.engine.ReadingEngine
import org.junit.Assert.*
import org.junit.Test
import java.util.BitSet
import java.util.Random

class EngineTest {
    private val engine = ReadingEngine(bible)
    private val sentenceEnd = Regex("[.?!][\\u2019\\u201d\"')\\]]*$")

    private fun mark(read: BitSet, b: BuiltReading) = b.passages.forEach { read.set(it.first, it.last + 1) }

    // ---------------------------------------------------------------- the text

    @Test fun textCounts() {
        assertEquals(66, bible.books.size)
        assertEquals(1189, bible.chapters.size)
        assertEquals(31103, bible.verseCount)
        assertTrue(bible.totalWords in 748_000..764_000)
        assertEquals(39, bible.books.count { it.isOt })
    }

    @Test fun psalmTitlesAreHeadingsNotVerseText() {
        val v6 = idx("PSA", 23, 6)
        assertFalse(bible.texts[v6].contains("A Psalm by David"))
        assertEquals("A Psalm by David.", bible.headings[idx("PSA", 24, 1)])
    }

    @Test fun longestSentencesMatchThePlan() {
        val longest = (0 until bible.unitCount).maxOf { bible.wordsBetween(bible.unitFirst[it], bible.unitLast[it]) }
        assertEquals(320, longest) // Luke 3:23-38
        assertTrue(bible.words.max() < 100)
    }

    // ---------------------------------------------------------------- golden readings

    @Test fun goldenLuke15() {
        val read = BitSet()
        val first = engine.build(300, read, Random(1), startAt = idx("LUK", 15, 11))!!
        assertEquals("Luke 15:11–21", Format.refs(bible, first.passages))
        assertEquals(244, first.words)
        assertEquals(idx("LUK", 15, 22), first.continuation)
        mark(read, first)
        val second = engine.build(300, read, Random(2), continuation = first.continuation)!!
        assertEquals("Luke 15:22–32", Format.refs(bible, second.passages))
        assertEquals(233, second.words)
    }

    // ---------------------------------------------------------------- properties

    @Test fun neverLongerThanTheLimit_neverRepeats_endsOnSentenceEnd() {
        val rnd = Random(7)
        for (limit in 100..1500 step 25) {
            val read = BitSet()
            repeat(120) {
                val b = engine.build(limit, read, rnd, continuation = -1) ?: return@repeat
                assertTrue("limit $limit words ${b.words}", b.words <= limit)
                assertTrue(b.passages.size in 1..3)
                for (p in b.passages) {
                    assertTrue("repeat at limit $limit", read.nextSetBit(p.first).let { it < 0 || it > p.last })
                    if (!b.forcedContinuation) assertTrue(
                        "must end on a sentence end (or the end of a chapter): ${Format.ref(bible, p)}",
                        bible.isChapterEnd(p.last) || bible.texts[p.last].isEmpty() || sentenceEnd.containsMatchIn(bible.texts[p.last]),
                    )
                    assertEquals(bible.wordsBetween(p.first, p.last), p.words)
                }
                // passages inside one reading never overlap each other
                val seen = BitSet()
                for (p in b.passages) { assertFalse(seen.intersects(BitSet().also { it.set(p.first, p.last + 1) })); seen.set(p.first, p.last + 1) }
                mark(read, b)
            }
        }
    }

    @Test fun firstPassageStartsAtAChapterStartOrWhereReadingStopped() {
        val rnd = Random(11)
        val read = BitSet()
        repeat(2000) {
            val b = engine.build(300, read, rnd) ?: return@repeat
            val s = b.passages[0].first
            assertTrue(bible.isChapterStart(s) || read.get(s - 1))
            mark(read, b)
        }
    }

    @Test fun smallBooksBundleIntoOneDay() {
        // A tiny book (Obadiah, 619 words in total) cannot go wrong near the end of a long run.
        val read = BitSet()
        val rnd = Random(3)
        var bundled = 0
        while (true) {
            val b = engine.build(300, read, rnd) ?: break
            if (b.passages.size > 1) bundled++
            mark(read, b)
        }
        assertEquals("every verse read exactly once", bible.verseCount, read.cardinality())
        assertTrue(bundled > 50)
    }

    @Test fun fullBibleSimulationAt300() {
        val read = BitSet()
        val rnd = Random(2026)
        var days = 0
        var wordSum = 0L
        var under = 0
        var cont = -1
        while (true) {
            val b = engine.build(300, read, rnd, continuation = cont) ?: break
            days++
            wordSum += b.words
            if (b.words * 2 < 300) under++
            mark(read, b)
            cont = b.continuation
        }
        val fill = wordSum / (days * 300.0)
        println("simulation @300: days=$days fill=${"%.2f".format(fill)} underHalf=$under")
        assertEquals(bible.verseCount, read.cardinality())
        assertTrue("days $days", days in 2400..4200)
        assertTrue("fill $fill", fill in 0.70..0.95)
    }

    @Test fun changingTheLimitMidwayNeverRepeats() {
        val read = BitSet()
        val rnd = Random(99)
        var cont = -1
        var n = 0
        while (true) {
            val limit = listOf(120, 300, 700, 1500, 250)[(n++ / 40) % 5]
            val b = engine.build(limit, read, rnd, continuation = cont) ?: break
            assertTrue(b.words <= limit)
            b.passages.forEach { assertTrue(read.nextSetBit(it.first).let { x -> x < 0 || x > it.last }) }
            mark(read, b)
            cont = b.continuation
        }
        assertEquals(bible.verseCount, read.cardinality())
    }

    @Test fun oversizeSentenceIsSplitBetweenVerses() {
        val read = BitSet()
        val start = idx("LUK", 3, 23)
        val b = engine.build(100, read, Random(1), startAt = start)!!
        assertTrue(b.forcedContinuation)
        assertTrue(b.words <= 100)
        assertTrue(b.continuation > b.passages[0].last)
        assertEquals(b.passages[0].last + 1, b.continuation)
    }

    @Test fun rebuildFromTheSameStartPointFits() {
        val read = BitSet()
        val start = idx("LUK", 15, 11)
        val long = engine.build(300, read, Random(1), startAt = start)!!
        val short = engine.build(150, read, Random(1), startAt = start)!!
        assertEquals(long.passages[0].first, short.passages[0].first)
        assertTrue(short.words <= 150)
    }

    @Test fun nothingLeftReturnsNull() {
        val read = BitSet(); read.set(0, bible.verseCount)
        assertNull(engine.build(300, read, Random(1)))
    }
}
