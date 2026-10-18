package com.bibledaily.app.domain

import android.content.Context
import com.bibledaily.app.data.ReadingStatus
import com.bibledaily.app.data.ThemeMode
import com.bibledaily.app.data.UserState

/**
 * A few values copied to SharedPreferences so the widget and the reminder can work
 * without loading the Bible or the whole state.
 */
object Mirror {
    private const val NAME = "mirror"

    fun write(ctx: Context, bible: com.bibledaily.app.data.Bible, st: UserState) {
        val t = st.today
        val readingRef = if (t != null && t.status == ReadingStatus.ACTIVE) Format.refs(bible, t.passages) else ""
        val readingMeta = if (t != null && t.status == ReadingStatus.ACTIVE) "${Format.number(t.words)} words · ${Format.minutesText(t.words)}" else ""
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putLong("seed", st.installSeed)
            .putLong("installDay", st.installEpochDay)
            .putString("readingRef", readingRef)
            .putString("readingMeta", readingMeta)
            .putBoolean("reminderOn", st.settings.reminderOn)
            .putInt("reminderMinutes", st.settings.reminderMinutes)
            .putBoolean("doneToday", t?.status == ReadingStatus.DONE)
            .putString("theme", st.settings.theme.name)
            .apply()
    }

    fun prefs(ctx: Context) = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun theme(ctx: Context): ThemeMode = runCatching { ThemeMode.valueOf(prefs(ctx).getString("theme", "SYSTEM")!!) }.getOrDefault(ThemeMode.SYSTEM)
}
