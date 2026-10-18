package com.bibledaily.app.data

import android.content.Context
import com.bibledaily.app.domain.StateStorage
import java.io.File
import java.util.concurrent.Executors

/** Writes the state atomically (temp file, then rename) on a background thread. */
class FileStorage(context: Context) : StateStorage {
    private val file = File(context.filesDir, "state.json")
    private val tmp = File(context.filesDir, "state.json.tmp")
    private val io = Executors.newSingleThreadExecutor()

    override fun load(): String? = runCatching { if (file.exists()) file.readText() else null }.getOrNull()

    override fun save(json: String) {
        io.execute {
            runCatching {
                tmp.writeText(json)
                if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
            }
        }
    }
}
