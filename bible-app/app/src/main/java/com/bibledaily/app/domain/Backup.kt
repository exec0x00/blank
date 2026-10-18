package com.bibledaily.app.domain

import com.bibledaily.app.data.Bible
import com.bibledaily.app.data.Reading
import com.bibledaily.app.data.ReadingStatus
import com.bibledaily.app.data.Settings
import com.bibledaily.app.data.StateCodec
import com.bibledaily.app.data.UserState
import com.bibledaily.app.engine.Passage
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.BitSet

/** A progress file, parsed and checked, ready to preview and import. */
class ImportFile(
    val deviceLabel: String,
    val exportedAt: String,
    val round: Int,
    val read: BitSet,
    val wordsRead: Int,
    val history: List<Reading>,
    val current: Reading?,
    val settings: Settings?,
)

enum class ImportError(val message: String) {
    NOT_BIBLE("This file isn't a Bible progress file. Choose a file you made with Export progress."),
    NEWER("This file was made by a newer version of the app. Update the app on this device, then import again."),
    DAMAGED("This file is incomplete or damaged. Export it again on the other device and import the new file."),
    EMPTY("This file has no readings in it. Nothing was changed."),
}

sealed interface ParseResult {
    data class Ok(val file: ImportFile) : ParseResult
    data class Error(val error: ImportError) : ParseResult
}

enum class ImportMode { COMBINE, REPLACE }

class Backup(private val bible: Bible, private val textVersion: String) {
    private val codec = StateCodec(bible)

    fun fileName(date: String) = "bible-progress-$date.json"

    // ---------------------------------------------------------------- export

    fun export(st: UserState, deviceLabel: String, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val ranges = codec.encodeRanges(st.read)
        val words = codec.wordsIn(st.read)
        val history = st.history
        val currentReading = st.today?.takeIf { it.status == ReadingStatus.ACTIVE } ?: st.queued
        return JSONObject().apply {
            put("app", "bible")
            put("format", 1)
            put("exportedAt", DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(Instant.ofEpochMilli(nowMillis).atZone(zone)))
            put("deviceLabel", deviceLabel)
            put("bible", JSONObject().put("translation", "WEB").put("edition", "engwebp").put("textVersion", textVersion))
            put("progress", JSONObject().put("round", st.round).put("readRanges", JSONArray(ranges)).put("wordsRead", words))
            put("history", JSONArray().also { a ->
                history.forEach { r ->
                    a.put(JSONObject().put("date", r.date)
                        .put("passages", JSONArray(r.passages.map(codec::passageToString)))
                        .put("words", r.words).put("limit", r.limit).put("extra", r.extra))
                }
            })
            if (currentReading != null) {
                put("current", JSONObject().put("date", currentReading.date)
                    .put("passages", JSONArray(currentReading.passages.map(codec::passageToString)))
                    .put("continuation", currentReading.continuation >= 0))
            }
            put("settings", codec.settingsToJson(st.settings))
            put("integrity", integrity(st.round, ranges, words, history.map { r ->
                HistoryRow(r.date, r.passages.map(codec::passageToString), r.words, r.limit, r.extra)
            }))
        }.toString(2)
    }

    private class HistoryRow(val date: String, val passages: List<String>, val words: Int, val limit: Int, val extra: Boolean)

    /** SHA-256 over a fixed text form of the progress and history, independent of JSON key order. */
    private fun integrity(round: Int, ranges: List<String>, words: Int, history: List<HistoryRow>): String {
        val sb = StringBuilder()
        sb.append("r=").append(round).append(";w=").append(words).append(";p=").append(ranges.joinToString(","))
        for (h in history) {
            sb.append(";h=").append(h.date).append('|').append(h.passages.joinToString(","))
                .append('|').append(h.words).append('|').append(h.limit).append('|').append(h.extra)
        }
        val d = MessageDigest.getInstance("SHA-256").digest(sb.toString().toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }
    }

    // ---------------------------------------------------------------- import

    fun parse(text: String): ParseResult {
        val o = try { JSONObject(text) } catch (e: Exception) { return ParseResult.Error(ImportError.NOT_BIBLE) }
        if (o.optString("app") != "bible") return ParseResult.Error(ImportError.NOT_BIBLE)
        val format = o.optInt("format", -1)
        if (format > 1) return ParseResult.Error(ImportError.NEWER)
        if (format < 1) return ParseResult.Error(ImportError.DAMAGED)
        try {
            val prog = o.getJSONObject("progress")
            val ra = prog.getJSONArray("readRanges")
            val ranges = List(ra.length()) { ra.getString(it) }
            val read = codec.decodeRanges(ranges) ?: return ParseResult.Error(ImportError.DAMAGED)
            val words = codec.wordsIn(read)
            if (prog.getInt("wordsRead") != words) return ParseResult.Error(ImportError.DAMAGED)
            val round = prog.optInt("round", 1)

            val ha = o.getJSONArray("history")
            val rows = ArrayList<HistoryRow>()
            val history = ArrayList<Reading>()
            for (i in 0 until ha.length()) {
                val h = ha.getJSONObject(i)
                val pa = h.getJSONArray("passages")
                val ps = List(pa.length()) { pa.getString(it) }
                val passages = ps.map { codec.passageFromString(it) ?: return ParseResult.Error(ImportError.DAMAGED) }
                rows += HistoryRow(h.getString("date"), ps, h.getInt("words"), h.getInt("limit"), h.optBoolean("extra"))
                history += Reading(
                    id = 0, date = h.getString("date"), status = ReadingStatus.DONE, extra = h.optBoolean("extra"),
                    limit = h.getInt("limit"), passages = passages, continuation = -1, forced = false,
                    createdAt = 0, completedAt = 0,
                )
            }
            if (integrity(round, ranges, words, rows) != o.optString("integrity")) return ParseResult.Error(ImportError.DAMAGED)
            if (read.isEmpty && history.isEmpty()) return ParseResult.Error(ImportError.EMPTY)

            val current = o.optJSONObject("current")?.let { c ->
                val pa = c.getJSONArray("passages")
                val passages = List(pa.length()) { codec.passageFromString(pa.getString(it)) ?: return ParseResult.Error(ImportError.DAMAGED) }
                if (passages.isEmpty()) null else Reading(
                    id = 0, date = c.getString("date"), status = ReadingStatus.ACTIVE, extra = false, limit = 0,
                    passages = passages, continuation = -1, forced = false, createdAt = 0,
                )
            }
            return ParseResult.Ok(ImportFile(
                deviceLabel = o.optString("deviceLabel", "another device"), exportedAt = o.optString("exportedAt"),
                round = round, read = read, wordsRead = words, history = history, current = current,
                settings = o.optJSONObject("settings")?.let(codec::settingsFromJson),
            ))
        } catch (e: Exception) {
            return ParseResult.Error(ImportError.DAMAGED)
        }
    }

    /** What the state would be after importing. Pure; the controller adds the snapshot. */
    fun apply(st: UserState, file: ImportFile, mode: ImportMode): UserState = when (mode) {
        ImportMode.COMBINE -> {
            val read = st.read.clone() as BitSet
            read.or(file.read)
            val seen = HashSet<String>()
            val merged = ArrayList<Reading>()
            for (r in st.history + file.history) {
                val key = r.date + "|" + r.extra + "|" + r.passages.joinToString(",") { "${it.first}-${it.last}" }
                if (seen.add(key)) merged += r
            }
            merged.sortBy { it.date }
            st.copy(
                read = read, wordsRead = codec.wordsIn(read), history = merged,
                round = maxOf(st.round, file.round), pendingContinuation = if (st.pendingContinuation >= 0 && read.get(st.pendingContinuation)) -1 else st.pendingContinuation,
            )
        }
        ImportMode.REPLACE -> {
            val cur = file.current
            val active = cur?.takeIf { c -> c.passages.none { p -> file.read.nextSetBit(p.first).let { it in p.first..p.last } } }
            st.copy(
                read = file.read, wordsRead = file.wordsRead, history = file.history.sortedBy { it.date },
                round = file.round, today = active?.copy(id = st.nextId, limit = (file.settings ?: st.settings).dailyWords, createdAt = 0),
                nextId = st.nextId + 1, queued = null, extra = null, pendingContinuation = -1, pendingForced = false,
                settings = (file.settings ?: st.settings).copy(onboarded = true),
            )
        }
    }
}
