package com.bibledaily.app.data

import com.bibledaily.app.engine.Passage
import java.util.BitSet

enum class ReadingStatus { ACTIVE, DONE }

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** A reading: one to three passages, either waiting to be read or already marked read. */
data class Reading(
    val id: Long,
    val date: String,               // ISO local date the reading belongs to
    val status: ReadingStatus,
    val extra: Boolean,
    val limit: Int,
    val passages: List<Passage>,
    val continuation: Int,          // verse index where this passage carries on, or -1
    val forced: Boolean,            // continuation caused by splitting an over-long sentence
    val createdAt: Long,
    val completedAt: Long = 0L,
) {
    val words get() = passages.sumOf { it.words }
    val firstVerse get() = passages.first().first
    val lastVerse get() = passages.last().last
}

data class Settings(
    val dailyWords: Int = 300,
    val finishPassages: Boolean = true,
    val verseNumbers: Boolean = true,
    val reminderOn: Boolean = false,
    val reminderMinutes: Int = 7 * 60 + 30,
    val textScale: Float = 1f,
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val lightIcon: Boolean = false,
    val onboarded: Boolean = false,
)

data class UserState(
    val round: Int = 1,
    val read: BitSet = BitSet(),
    val wordsRead: Int = 0,
    val history: List<Reading> = emptyList(),
    val today: Reading? = null,
    val queued: Reading? = null,
    val extra: Reading? = null,
    val pendingContinuation: Int = -1,
    val pendingForced: Boolean = false,
    val swapDate: String = "",
    val swapsUsed: Int = 0,
    val installSeed: Long = 0L,
    val installEpochDay: Long = 0L,
    val lastExportAt: Long = 0L,
    val readingsAtLastExport: Int = 0,
    val snapshot: String? = null,
    val snapshotAt: Long = 0L,
    val settings: Settings = Settings(),
    val nextId: Long = 1L,
) {
    val readingsDone get() = history.size
}
