package com.bibledaily.app.domain

import org.json.JSONArray
import java.time.LocalDate

/** An entry of the curated verse-of-the-day library. */
data class LibraryVerse(
    val ref: String,
    val text: String,
    val sentence: String,
    val topic: String,
    val firstId: Int,
    val lastId: Int,
)

object VerseOfDay {
    fun parse(json: String): List<LibraryVerse> {
        val arr = JSONArray(json)
        return List(arr.length()) { i ->
            val o = arr.getJSONObject(i)
            LibraryVerse(o.getString("ref"), o.getString("text"), o.getString("sentence"),
                o.getString("topic"), o.getInt("first"), o.getInt("last"))
        }
    }

    /** SplitMix64: tiny, deterministic and identical in the app and the widgets. */
    private class Mix(var s: Long) {
        fun next(): Long {
            s += -0x61c8864680b583ebL
            var z = s
            z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
            z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
            return z xor (z ushr 31)
        }
        fun below(n: Int): Int = ((next() ushr 1) % n).toInt()
    }

    /** The library in the order it will be shown: shuffled once with the install seed. */
    fun order(size: Int, seed: Long): IntArray {
        val idx = IntArray(size) { it }
        val r = Mix(seed)
        for (i in size - 1 downTo 1) {
            val j = r.below(i + 1)
            val t = idx[i]; idx[i] = idx[j]; idx[j] = t
        }
        return idx
    }

    /** Index into the library for a date. Every verse appears once before any repeats. */
    fun indexFor(size: Int, seed: Long, installEpochDay: Long, date: LocalDate): Int {
        val order = order(size, seed)
        val day = (date.toEpochDay() - installEpochDay)
        val pos = ((day % size) + size) % size
        return order[pos.toInt()]
    }

    fun forDate(library: List<LibraryVerse>, seed: Long, installEpochDay: Long, date: LocalDate): LibraryVerse =
        library[indexFor(library.size, seed, installEpochDay, date)]
}
