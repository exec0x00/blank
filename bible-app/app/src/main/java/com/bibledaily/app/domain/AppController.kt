package com.bibledaily.app.domain

import com.bibledaily.app.data.Bible
import com.bibledaily.app.data.Reading
import com.bibledaily.app.data.ReadingStatus
import com.bibledaily.app.data.Settings
import com.bibledaily.app.data.StateCodec
import com.bibledaily.app.data.UserState
import com.bibledaily.app.engine.ReadingEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.BitSet
import java.util.Random

interface StateStorage {
    fun load(): String?
    fun save(json: String)
}

class MemoryStorage(var json: String? = null) : StateStorage {
    override fun load() = json
    override fun save(json: String) { this.json = json }
}

open class Clock(private val zone: () -> ZoneId = { ZoneId.systemDefault() }) {
    open fun nowMillis(): Long = System.currentTimeMillis()
    fun today(): LocalDate = Instant.ofEpochMilli(nowMillis()).atZone(zone()).toLocalDate()
}

/** What the Done screen needs to celebrate a reading. */
data class Completion(
    val reading: Reading,
    val wordsBefore: Int,
    val wordsAfter: Int,
    val streakAfter: Int,
)

/**
 * Owns the user's state and enforces the day rules (plan §8.7): one reading per local day,
 * missed days never pile up, swaps are limited, extra readings are opt-in.
 */
class AppController(
    val bible: Bible,
    val library: List<LibraryVerse>,
    private val storage: StateStorage,
    val clock: Clock = Clock(),
    private val rnd: Random = Random(),
) {
    val codec = StateCodec(bible)
    val engine = ReadingEngine(bible)

    private val _state: MutableStateFlow<UserState>
    val state: StateFlow<UserState> get() = _state

    var onChanged: ((UserState) -> Unit)? = null

    init {
        val saved = storage.load()?.let { runCatching { codec.decode(it) }.getOrNull() }
        val fresh = saved ?: UserState(
            read = BitSet(bible.verseCount),
            installSeed = rnd.nextLong(),
            installEpochDay = clock.today().toEpochDay(),
        )
        _state = MutableStateFlow(fresh)
        ensureToday()
    }

    val s: UserState get() = _state.value

    private fun commit(next: UserState) {
        _state.value = next
        storage.save(codec.encode(next))
        onChanged?.invoke(next)
    }

    // ---------------------------------------------------------------- building

    private fun make(
        st: UserState, date: String, extra: Boolean,
        startAt: Int = -1, avoid: Int = -1, reserved: BitSet? = null, useContinuation: Boolean = true,
    ): Pair<Reading, UserState>? {
        val cont = if (useContinuation && !extra && st.pendingContinuation >= 0 &&
            (st.settings.finishPassages || st.pendingForced)) st.pendingContinuation else -1
        val built = engine.build(st.settings.dailyWords, st.read, rnd, cont, startAt, avoid, reserved) ?: return null
        val keepCont = !extra && (st.settings.finishPassages || built.forcedContinuation)
        val reading = Reading(
            id = st.nextId, date = date, status = ReadingStatus.ACTIVE, extra = extra,
            limit = st.settings.dailyWords, passages = built.passages,
            continuation = if (keepCont) built.continuation else -1,
            forced = built.forcedContinuation, createdAt = clock.nowMillis(),
        )
        return reading to st.copy(nextId = st.nextId + 1)
    }

    private fun overlaps(r: Reading, read: BitSet) =
        r.passages.any { p -> read.nextSetBit(p.first).let { it in p.first..p.last } }

    private fun versesOf(r: Reading?): BitSet? =
        r?.let { BitSet(bible.verseCount).also { b -> it.passages.forEach { p -> b.set(p.first, p.last + 1) } } }

    private fun isValid(r: Reading?, st: UserState) =
        r != null && !overlaps(r, st.read) && r.words <= st.settings.dailyWords

    // ---------------------------------------------------------------- the day

    /** Makes sure the state holds the right reading for the current local date. */
    fun ensureToday() {
        var st = s
        val date = clock.today()
        val iso = date.toString()
        val t = st.today
        when {
            t == null -> st = fresh(st, iso)
            t.status == ReadingStatus.DONE && runCatching { LocalDate.parse(t.date) }.getOrDefault(date) < date ->
                st = fresh(st, iso)
            t.status == ReadingStatus.ACTIVE && !isValid(t, st) -> st = rebuildToday(st)
        }
        if (st.swapDate != iso) st = st.copy(swapDate = iso, swapsUsed = 0)
        if (st.queued != null && !isValid(st.queued, st)) st = st.copy(queued = null)
        if (st.extra != null && !isValid(st.extra, st)) st = st.copy(extra = null)
        if (st != s) commit(st)
    }

    private fun fresh(st: UserState, iso: String): UserState {
        val q = st.queued
        if (isValid(q, st)) return st.copy(today = q!!.copy(date = iso, status = ReadingStatus.ACTIVE), queued = null)
        val made = make(st, iso, extra = false) ?: return st.copy(today = null, queued = null)
        return made.second.copy(today = made.first, queued = null)
    }

    private fun rebuildToday(st: UserState): UserState {
        val t = st.today ?: return st
        val iso = t.date
        val made = make(st, iso, extra = false, startAt = if (t.firstVerse >= 0 && !st.read.get(t.firstVerse)) t.firstVerse else -1)
            ?: return st.copy(today = null)
        return made.second.copy(today = made.first)
    }

    val finished: Boolean get() = s.read.cardinality() >= bible.verseCount

    fun swapsLeft(): Int = if (s.swapDate == clock.today().toString()) MAX_SWAPS - s.swapsUsed else MAX_SWAPS

    /** Replaces today's unread reading with a different random one. Returns false if no swaps are left. */
    fun swap(): Boolean {
        val st = s
        val t = st.today ?: return false
        if (t.status != ReadingStatus.ACTIVE || swapsLeft() <= 0) return false
        val made = make(st, t.date, extra = false, avoid = t.firstVerse, useContinuation = false) ?: return false
        commit(made.second.copy(today = made.first, swapDate = clock.today().toString(), swapsUsed = (if (st.swapDate == clock.today().toString()) st.swapsUsed else 0) + 1))
        return true
    }

    /** Marks today's reading as read. Progress changes only here. */
    fun markRead(): Completion? {
        val st = s
        val r = st.today ?: return null
        if (r.status != ReadingStatus.ACTIVE) return null
        val read = st.read.clone() as BitSet
        r.passages.forEach { read.set(it.first, it.last + 1) }
        val done = r.copy(status = ReadingStatus.DONE, completedAt = clock.nowMillis())
        var next = st.copy(
            read = read, wordsRead = codec.wordsIn(read),
            history = st.history + done, today = done, queued = null,
            pendingContinuation = r.continuation, pendingForced = r.forced && r.continuation >= 0,
        )
        val tomorrow = clock.today().plusDays(1).toString()
        make(next, tomorrow, extra = false)?.let { (q, n) -> next = n.copy(queued = q) }
        commit(next)
        return Completion(done, st.wordsRead, next.wordsRead, Stats.currentStreak(next.history, clock.today()))
    }

    /** Builds an extra reading ("Read another passage"). It counts toward progress, not the streak. */
    fun startExtra(): Reading? {
        val st = s
        val made = make(st, clock.today().toString(), extra = true, reserved = versesOf(st.queued ?: st.today?.takeIf { it.status == ReadingStatus.ACTIVE }), useContinuation = false)
            ?: return null
        commit(made.second.copy(extra = made.first))
        return made.first
    }

    fun discardExtra() { if (s.extra != null) commit(s.copy(extra = null)) }

    fun markExtraRead(): Completion? {
        val st = s
        val r = st.extra ?: return null
        val read = st.read.clone() as BitSet
        r.passages.forEach { read.set(it.first, it.last + 1) }
        val done = r.copy(status = ReadingStatus.DONE, completedAt = clock.nowMillis(), continuation = -1)
        var next = st.copy(read = read, wordsRead = codec.wordsIn(read), history = st.history + done, extra = null)
        if (next.queued != null && !isValid(next.queued, next)) {
            val tomorrow = clock.today().plusDays(1).toString()
            next = next.copy(queued = null)
            make(next, tomorrow, extra = false)?.let { (q, n) -> next = n.copy(queued = q) }
        }
        commit(next)
        return Completion(done, st.wordsRead, next.wordsRead, Stats.currentStreak(next.history, clock.today()))
    }

    // ---------------------------------------------------------------- settings

    /** Applies a new daily limit. Returns true when today's unread reading had to be rebuilt to fit. */
    fun setDailyWords(words: Int): Boolean {
        val w = words.coerceIn(ReadingEngine.MIN_LIMIT, ReadingEngine.MAX_LIMIT)
        var st = s.copy(settings = s.settings.copy(dailyWords = w))
        var rebuilt = false
        val t = st.today
        if (t != null && t.status == ReadingStatus.ACTIVE && t.words > w) { st = rebuildToday(st); rebuilt = true }
        val q = st.queued
        if (q != null && q.words > w) {
            val made = make(st, q.date, extra = false, startAt = q.firstVerse)
            st = if (made != null) made.second.copy(queued = made.first) else st.copy(queued = null)
        }
        if (st.extra != null && st.extra.words > w) st = st.copy(extra = null)
        commit(st)
        return rebuilt
    }

    fun updateSettings(f: (Settings) -> Settings) {
        val st = s
        val ns = f(st.settings)
        if (ns.dailyWords != st.settings.dailyWords) { setDailyWords(ns.dailyWords); commit(s.copy(settings = ns.copy(dailyWords = s.settings.dailyWords))) }
        else commit(st.copy(settings = ns))
    }

    fun markExported(nowMs: Long) = commit(s.copy(lastExportAt = nowMs, readingsAtLastExport = s.history.size))

    // ---------------------------------------------------------------- reset, rounds, snapshots

    private fun snapshotJson(st: UserState) = codec.encode(st.copy(snapshot = null))

    fun resetProgress() {
        val st = s
        val cleared = st.copy(
            round = 1, read = BitSet(bible.verseCount), wordsRead = 0, history = emptyList(),
            today = null, queued = null, extra = null, pendingContinuation = -1, pendingForced = false,
            snapshot = snapshotJson(st), snapshotAt = clock.nowMillis(),
        )
        commit(cleared)
        ensureToday()
    }

    fun startNewRound() {
        val st = s
        commit(st.copy(round = st.round + 1, read = BitSet(bible.verseCount), wordsRead = 0,
            today = null, queued = null, extra = null, pendingContinuation = -1, pendingForced = false))
        ensureToday()
    }

    /** Replaces the whole state (used by import). The previous state is kept as a 30-day snapshot. */
    fun applyImported(next: UserState) {
        val prev = s
        commit(next.copy(snapshot = snapshotJson(prev), snapshotAt = clock.nowMillis()))
        ensureToday()
    }

    fun snapshotAvailable(): Boolean =
        s.snapshot != null && clock.nowMillis() - s.snapshotAt < SNAPSHOT_MS

    fun restoreSnapshot(): Boolean {
        if (!snapshotAvailable()) return false
        val restored = runCatching { codec.decode(s.snapshot!!) }.getOrNull() ?: return false
        commit(restored.copy(snapshot = null, snapshotAt = 0L))
        ensureToday()
        return true
    }

    /** Rebuilds today's and tomorrow's readings after progress changed from outside the normal flow. */
    fun rebuildAfterProgressChange() {
        var st = s
        val t = st.today
        if (t != null && t.status == ReadingStatus.ACTIVE && overlaps(t, st.read)) st = rebuildToday(st)
        if (st.queued != null && overlaps(st.queued, st.read)) st = st.copy(queued = null)
        commit(st)
        ensureToday()
    }

    companion object {
        const val MAX_SWAPS = 3
        const val SNAPSHOT_MS = 30L * 24 * 60 * 60 * 1000
    }
}
