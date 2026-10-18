package com.bibledaily.app

import com.bibledaily.app.data.Bible
import com.bibledaily.app.domain.LibraryVerse
import com.bibledaily.app.domain.VerseOfDay
import java.io.File

object TestData {
    private val dir: File = listOf("src/main/assets", "app/src/main/assets").map(::File).first { it.isDirectory }

    val bible: Bible by lazy {
        Bible.load(File(dir, "bible.txt").inputStream(), File(dir, "books.txt").inputStream())
    }

    val library: List<LibraryVerse> by lazy { VerseOfDay.parse(File(dir, "library.json").readText()) }

    fun idx(book: String, ch: Int, v: Int): Int {
        val b = bible.bookByCode(book)
        return bible.indexOfId(b.index * 1_000_000 + ch * 1000 + v).also { require(it >= 0) { "no such verse $book $ch:$v" } }
    }
}
