package com.bibledaily.app.data

import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader

class Book(
    val index: Int,
    val code: String,
    val name: String,
    val abbr: String,
    val isOt: Boolean,
    val intro: String,
) {
    var firstVerse = 0
    var lastVerse = 0
    var words = 0
    var firstChapter = 0
    var chapterCount = 0
}

class Chapter(
    val book: Book,
    val number: Int,
    val firstVerse: Int,
    val lastVerse: Int,
    val words: Int,
)

/**
 * The bundled World English Bible, held in memory.
 *
 * A verse is addressed by its index (0..verseCount-1, canonical order). A verse *id*
 * (book * 1,000,000 + chapter * 1,000 + verse) is the stable form used in files.
 */
class Bible private constructor(
    val books: List<Book>,
    val chapters: List<Chapter>,
    val ids: IntArray,
    val words: IntArray,
    val texts: Array<String>,
    val headings: Array<String>,
    private val flags: ByteArray,
    val bookOfVerse: ByteArray,
    val chapterOfVerse: IntArray,
    val cumWords: IntArray,
) {
    val verseCount get() = ids.size
    val totalWords get() = cumWords[ids.size]
    val otWords: Int by lazy { cumWords[books[38].lastVerse + 1] }
    val ntWords: Int get() = totalWords - otWords

    // sentence-safe units
    lateinit var unitFirst: IntArray
        private set
    lateinit var unitLast: IntArray
        private set
    lateinit var unitParaEnd: BooleanArray
        private set
    lateinit var unitOfVerse: IntArray
        private set
    val unitCount get() = unitFirst.size

    fun paraStart(v: Int) = (flags[v].toInt() and 1) != 0
    fun poetry(v: Int) = (flags[v].toInt() shr 1) and 3
    fun book(v: Int): Book = books[bookOfVerse[v] - 1]
    fun chapter(v: Int): Chapter = chapters[chapterOfVerse[v]]
    fun chapterNumber(v: Int) = (ids[v] / 1000) % 1000
    fun verseNumber(v: Int) = ids[v] % 1000
    fun isChapterStart(v: Int) = v == 0 || chapterOfVerse[v] != chapterOfVerse[v - 1]
    fun isChapterEnd(v: Int) = v == ids.size - 1 || chapterOfVerse[v] != chapterOfVerse[v + 1]
    fun wordsBetween(first: Int, last: Int) = cumWords[last + 1] - cumWords[first]

    /** Index of a verse id, or -1 when the id does not exist in this text. */
    fun indexOfId(id: Int): Int {
        val i = ids.binarySearch(id)
        return if (i >= 0) i else -1
    }

    fun bookByCode(code: String) = books.first { it.code == code }
    fun chapterOf(book: Book, number: Int): Chapter? =
        if (number in 1..book.chapterCount) chapters[book.firstChapter + number - 1] else null

    companion object {
        private val SENT_END = Regex("[.?!][\\u2019\\u201d\"')\\]]*$")

        fun load(bible: InputStream, books: InputStream): Bible =
            parse(BufferedReader(InputStreamReader(bible, Charsets.UTF_8)).readLines(),
                BufferedReader(InputStreamReader(books, Charsets.UTF_8)).readLines())

        fun parse(verseLines: List<String>, bookLines: List<String>): Bible {
            val bookList = bookLines.filter { it.isNotBlank() }.map { l ->
                val p = l.split('\t')
                Book(p[0].toInt(), p[1], p[2], p[3], p[4] == "OT", p[5])
            }
            val n = verseLines.size
            val ids = IntArray(n)
            val words = IntArray(n)
            val flags = ByteArray(n)
            val texts = Array(n) { "" }
            val headings = Array(n) { "" }
            val bookOf = ByteArray(n)
            val chapterOf = IntArray(n)
            val cum = IntArray(n + 1)
            val chapters = ArrayList<Chapter>(1189)

            var curBook = -1
            var curChapterKey = -1
            var chapStart = 0
            fun closeChapter(endExclusive: Int) {
                if (endExclusive > chapStart) {
                    val b = bookList[curBook - 1]
                    chapters += Chapter(b, ids[chapStart] / 1000 % 1000, chapStart, endExclusive - 1, cum[endExclusive] - cum[chapStart])
                }
            }
            for (i in 0 until n) {
                val p = verseLines[i].split('\t', limit = 4)
                val id = p[0].toInt()
                ids[i] = id
                flags[i] = p[1].toInt().toByte()
                headings[i] = p[2]
                texts[i] = p[3]
                words[i] = if (p[3].isEmpty()) 0 else countWords(p[3])
                cum[i + 1] = cum[i] + words[i]
                val b = id / 1_000_000
                val key = id / 1000
                if (key != curChapterKey) {
                    if (curChapterKey != -1) closeChapter(i)
                    curChapterKey = key
                    chapStart = i
                    if (b != curBook) {
                        curBook = b
                        bookList[b - 1].firstVerse = i
                        bookList[b - 1].firstChapter = chapters.size
                    }
                }
                bookOf[i] = b.toByte()
                chapterOf[i] = chapters.size
                bookList[b - 1].lastVerse = i
            }
            closeChapter(n)
            for (b in bookList) {
                b.words = cum[b.lastVerse + 1] - cum[b.firstVerse]
                b.chapterCount = chapters.count { it.book === b }
            }
            val bible = Bible(bookList, chapters, ids, words, texts, headings, flags, bookOf, chapterOf, cum)
            bible.buildUnits()
            return bible
        }

        private fun countWords(s: String): Int {
            var count = 0
            var inWord = false
            for (ch in s) {
                if (ch == ' ') inWord = false
                else if (!inWord) { inWord = true; count++ }
            }
            return count
        }
    }

    private fun buildUnits() {
        val first = ArrayList<Int>(27_000)
        val last = ArrayList<Int>(27_000)
        var start = 0
        for (i in ids.indices) {
            val chapterEnd = isChapterEnd(i)
            if (chapterEnd || SENT_END.containsMatchIn(texts[i])) {
                first += start; last += i
                start = i + 1
            }
        }
        unitFirst = first.toIntArray()
        unitLast = last.toIntArray()
        unitOfVerse = IntArray(ids.size)
        unitParaEnd = BooleanArray(unitFirst.size)
        for (u in unitFirst.indices) {
            for (v in unitFirst[u]..unitLast[u]) unitOfVerse[v] = u
            val next = unitLast[u] + 1
            unitParaEnd[u] = next >= ids.size || isChapterStart(next) || paraStart(next)
        }
    }
}
