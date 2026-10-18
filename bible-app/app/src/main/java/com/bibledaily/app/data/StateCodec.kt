package com.bibledaily.app.data

import com.bibledaily.app.engine.Passage
import org.json.JSONArray
import org.json.JSONObject
import java.util.BitSet

/** Turns user state into JSON and back. Verses are written as stable ids, never as indices. */
class StateCodec(private val bible: Bible) {

    // ----- verse ranges (shared with the backup file format) -----

    fun encodeRanges(bits: BitSet): List<String> {
        val out = ArrayList<String>()
        var v = bits.nextSetBit(0)
        while (v >= 0) {
            val end = bits.nextClearBit(v) - 1
            out += if (end == v) "${bible.ids[v]}" else "${bible.ids[v]}-${bible.ids[end]}"
            v = bits.nextSetBit(end + 1)
        }
        return out
    }

    /** Returns null when a range names a verse that does not exist or runs backwards. */
    fun decodeRanges(ranges: List<String>): BitSet? {
        val bits = BitSet(bible.verseCount)
        for (r in ranges) {
            val parts = r.split('-')
            val a = parts[0].toIntOrNull() ?: return null
            val b = if (parts.size > 1) parts[1].toIntOrNull() ?: return null else a
            if (parts.size > 2) return null
            val i = bible.indexOfId(a)
            val j = bible.indexOfId(b)
            if (i < 0 || j < 0 || j < i) return null
            bits.set(i, j + 1)
        }
        return bits
    }

    fun wordsIn(bits: BitSet): Int {
        var total = 0
        var v = bits.nextSetBit(0)
        while (v >= 0) {
            val end = bits.nextClearBit(v) - 1
            total += bible.wordsBetween(v, end)
            v = bits.nextSetBit(end + 1)
        }
        return total
    }

    // ----- passages -----

    fun passageToString(p: Passage) = "${bible.ids[p.first]}-${bible.ids[p.last]}"

    fun passageFromString(s: String): Passage? {
        val parts = s.split('-')
        if (parts.size != 2) return null
        val i = bible.indexOfId(parts[0].toIntOrNull() ?: return null)
        val j = bible.indexOfId(parts[1].toIntOrNull() ?: return null)
        if (i < 0 || j < i) return null
        return Passage(i, j, bible.wordsBetween(i, j))
    }

    private fun readingToJson(r: Reading) = JSONObject().apply {
        put("id", r.id); put("date", r.date); put("status", r.status.name); put("extra", r.extra)
        put("limit", r.limit); put("createdAt", r.createdAt); put("completedAt", r.completedAt)
        put("passages", JSONArray(r.passages.map(::passageToString)))
        put("cont", if (r.continuation >= 0) bible.ids[r.continuation] else 0)
        put("forced", r.forced)
    }

    private fun readingFromJson(o: JSONObject): Reading? {
        val arr = o.getJSONArray("passages")
        val passages = List(arr.length()) { passageFromString(arr.getString(it)) ?: return null }
        if (passages.isEmpty()) return null
        val cont = o.optInt("cont", 0)
        return Reading(
            id = o.getLong("id"), date = o.getString("date"),
            status = ReadingStatus.valueOf(o.getString("status")),
            extra = o.optBoolean("extra"), limit = o.getInt("limit"), passages = passages,
            continuation = if (cont > 0) bible.indexOfId(cont) else -1,
            forced = o.optBoolean("forced"), createdAt = o.optLong("createdAt"),
            completedAt = o.optLong("completedAt"),
        )
    }

    // ----- whole state -----

    fun encode(s: UserState): String = JSONObject().apply {
        put("v", 1)
        put("round", s.round)
        put("read", JSONArray(encodeRanges(s.read)))
        put("history", JSONArray().also { a -> s.history.forEach { a.put(readingToJson(it)) } })
        s.today?.let { put("today", readingToJson(it)) }
        s.queued?.let { put("queued", readingToJson(it)) }
        s.extra?.let { put("extra", readingToJson(it)) }
        put("pendingCont", if (s.pendingContinuation >= 0) bible.ids[s.pendingContinuation] else 0)
        put("pendingForced", s.pendingForced)
        put("swapDate", s.swapDate); put("swapsUsed", s.swapsUsed)
        put("installSeed", s.installSeed); put("installEpochDay", s.installEpochDay)
        put("lastExportAt", s.lastExportAt); put("readingsAtLastExport", s.readingsAtLastExport)
        s.snapshot?.let { put("snapshot", it) }
        put("snapshotAt", s.snapshotAt)
        put("nextId", s.nextId)
        put("settings", settingsToJson(s.settings))
    }.toString()

    fun decode(json: String): UserState {
        val o = JSONObject(json)
        val ra = o.getJSONArray("read")
        val read = decodeRanges(List(ra.length()) { ra.getString(it) }) ?: BitSet()
        val ha = o.getJSONArray("history")
        val history = ArrayList<Reading>()
        for (i in 0 until ha.length()) readingFromJson(ha.getJSONObject(i))?.let { history += it }
        val pend = o.optInt("pendingCont", 0)
        return UserState(
            round = o.optInt("round", 1), read = read, wordsRead = wordsIn(read), history = history,
            today = o.optJSONObject("today")?.let(::readingFromJson),
            queued = o.optJSONObject("queued")?.let(::readingFromJson),
            extra = o.optJSONObject("extra")?.let(::readingFromJson),
            pendingContinuation = if (pend > 0) bible.indexOfId(pend) else -1,
            pendingForced = o.optBoolean("pendingForced"),
            swapDate = o.optString("swapDate"), swapsUsed = o.optInt("swapsUsed"),
            installSeed = o.getLong("installSeed"), installEpochDay = o.getLong("installEpochDay"),
            lastExportAt = o.optLong("lastExportAt"), readingsAtLastExport = o.optInt("readingsAtLastExport"),
            snapshot = if (o.has("snapshot")) o.getString("snapshot") else null,
            snapshotAt = o.optLong("snapshotAt"),
            settings = settingsFromJson(o.optJSONObject("settings")),
            nextId = o.optLong("nextId", (history.maxOfOrNull { it.id } ?: 0L) + 1),
        )
    }

    fun settingsToJson(s: Settings) = JSONObject().apply {
        put("dailyWords", s.dailyWords); put("finishPassages", s.finishPassages)
        put("verseNumbers", s.verseNumbers); put("reminderOn", s.reminderOn)
        put("reminderMinutes", s.reminderMinutes); put("textScale", s.textScale.toDouble())
        put("theme", s.theme.name); put("lightIcon", s.lightIcon); put("onboarded", s.onboarded)
    }

    fun settingsFromJson(o: JSONObject?): Settings {
        val d = Settings()
        if (o == null) return d
        return Settings(
            dailyWords = o.optInt("dailyWords", d.dailyWords).coerceIn(100, 1500),
            finishPassages = o.optBoolean("finishPassages", d.finishPassages),
            verseNumbers = o.optBoolean("verseNumbers", d.verseNumbers),
            reminderOn = o.optBoolean("reminderOn", d.reminderOn),
            reminderMinutes = o.optInt("reminderMinutes", d.reminderMinutes).coerceIn(0, 1439),
            textScale = o.optDouble("textScale", d.textScale.toDouble()).toFloat().coerceIn(0.8f, 1.6f),
            theme = runCatching { ThemeMode.valueOf(o.optString("theme", "SYSTEM")) }.getOrDefault(ThemeMode.SYSTEM),
            lightIcon = o.optBoolean("lightIcon", d.lightIcon),
            onboarded = o.optBoolean("onboarded", d.onboarded),
        )
    }
}
