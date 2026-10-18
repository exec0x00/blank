package com.bibledaily.app

import com.bibledaily.app.TestData.bible
import com.bibledaily.app.TestData.library
import com.bibledaily.app.data.ReadingStatus
import com.bibledaily.app.domain.*
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.util.Random

class DomainTest {
    private class FakeClock(var day: LocalDate) : Clock({ ZoneId.of("UTC") }) {
        override fun nowMillis() = day.atTime(9, 0).atZone(ZoneId.of("UTC")).toInstant().toEpochMilli()
    }

    private fun controller(clock: Clock, storage: StateStorage = MemoryStorage()) =
        AppController(bible, library, storage, clock, Random(5))

    @Test fun oneReadingPerDayAndCarryOver() {
        val clock = FakeClock(LocalDate.of(2026, 10, 18))
        val c = controller(clock)
        val first = c.s.today!!
        c.ensureToday(); assertEquals(first.id, c.s.today!!.id)
        clock.day = clock.day.plusDays(3)          // missed days never pile up
        c.ensureToday(); assertEquals(first.id, c.s.today!!.id)
        assertEquals(ReadingStatus.ACTIVE, c.s.today!!.status)
    }

    @Test fun markReadThenTomorrowIsQueuedAndPromoted() {
        val clock = FakeClock(LocalDate.of(2026, 10, 18))
        val c = controller(clock)
        val done = c.markRead()!!
        assertEquals(1, Stats.currentStreak(c.s.history, clock.today()))
        assertTrue(done.wordsAfter > done.wordsBefore)
        val queued = c.s.queued!!
        assertNull(c.markRead())                    // cannot mark twice the same day
        clock.day = clock.day.plusDays(1)
        c.ensureToday()
        assertEquals(queued.passages, c.s.today!!.passages)
        assertEquals(1, c.s.history.size)
    }

    @Test fun lowerLimitRebuildsTodaysReading() {
        val c = controller(FakeClock(LocalDate.of(2026, 10, 18)))
        c.setDailyWords(1500); c.swap()
        val before = c.s.today!!
        if (before.words > 120) { assertTrue(c.setDailyWords(100)); assertTrue(c.s.today!!.words <= 100) }
    }

    @Test fun swapsAreLimited() {
        val c = controller(FakeClock(LocalDate.of(2026, 10, 18)))
        repeat(3) { assertTrue(c.swap()) }
        assertFalse(c.swap())
    }

    @Test fun extraReadingsDoNotCountForStreak() {
        val c = controller(FakeClock(LocalDate.of(2026, 10, 18)))
        c.markRead(); val streak = Stats.currentStreak(c.s.history, c.clock.today())
        c.startExtra(); c.markExtraRead()
        assertEquals(streak, Stats.currentStreak(c.s.history, c.clock.today()))
        assertEquals(2, c.s.history.size)
    }

    @Test fun stateSurvivesSaveAndLoad() {
        val clock = FakeClock(LocalDate.of(2026, 10, 18))
        val store = MemoryStorage()
        val c = controller(clock, store)
        c.markRead()
        val again = controller(clock, store)
        assertEquals(c.s.read, again.s.read)
        assertEquals(c.s.history.size, again.s.history.size)
        assertEquals(c.s.queued?.passages, again.s.queued?.passages)
    }

    @Test fun backupRoundTripCombineAndErrors() {
        val clock = FakeClock(LocalDate.of(2026, 10, 18))
        val a = controller(clock)
        repeat(5) { a.markRead(); clock.day = clock.day.plusDays(1); a.ensureToday() }
        val backup = Backup(bible, "2026-10")
        val text = backup.export(a.s, "Pixel 8", clock.nowMillis(), ZoneId.of("UTC"))
        val parsed = (backup.parse(text) as ParseResult.Ok).file
        assertEquals(a.s.read, parsed.read)
        assertEquals(a.s.wordsRead, parsed.wordsRead)

        val b = controller(FakeClock(LocalDate.of(2026, 10, 18)), MemoryStorage())
        b.markRead()
        val combined = backup.apply(b.s, parsed, ImportMode.COMBINE)
        val union = a.s.read.clone() as java.util.BitSet; union.or(b.s.read)
        assertEquals(union, combined.read)
        val replaced = backup.apply(b.s, parsed, ImportMode.REPLACE)
        assertEquals(a.s.read, replaced.read)

        assertEquals(ImportError.NOT_BIBLE, (backup.parse("{\"hello\":1}") as ParseResult.Error).error)
        assertEquals(ImportError.NOT_BIBLE, (backup.parse("nonsense") as ParseResult.Error).error)
        assertEquals(ImportError.NEWER, (backup.parse(text.replace("\"format\": 1", "\"format\": 2")) as ParseResult.Error).error)
        val tampered = text.replace(Regex("\"integrity\": \"[0-9a-f]{4}"), "\"integrity\": \"0000")
        assertEquals(ImportError.DAMAGED, (backup.parse(tampered) as ParseResult.Error).error)
    }

    @Test fun snapshotRestoresExactly() {
        val clock = FakeClock(LocalDate.of(2026, 10, 18))
        val c = controller(clock)
        c.markRead()
        val before = c.s.read.clone()
        c.resetProgress()
        assertTrue(c.s.read.isEmpty)
        assertTrue(c.restoreSnapshot())
        assertEquals(before, c.s.read)
    }

    @Test fun verseOfDayCoversTheWholeLibraryBeforeRepeating() {
        val seen = HashSet<Int>()
        val start = LocalDate.of(2026, 1, 1)
        repeat(library.size) { seen += VerseOfDay.indexFor(library.size, 12345L, start.toEpochDay(), start.plusDays(it.toLong())) }
        assertEquals(library.size, seen.size)
        assertEquals(VerseOfDay.indexFor(library.size, 9L, 0, start), VerseOfDay.indexFor(library.size, 9L, 0, start))
        assertEquals(366, library.size)
        library.forEach { assertTrue(it.text.split(" ").size <= 45) }
    }

    @Test fun formats() {
        assertEquals("Luke 15:11–21", Format.ref(bible, TestData.idx("LUK", 15, 11), TestData.idx("LUK", 15, 21)))
        assertEquals("Psalm 23:1", Format.ref(bible, TestData.idx("PSA", 23, 1), TestData.idx("PSA", 23, 1)))
        assertEquals(2, Format.minutes(244))
    }
}
