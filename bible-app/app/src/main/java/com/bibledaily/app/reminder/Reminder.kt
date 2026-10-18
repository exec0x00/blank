package com.bibledaily.app.reminder

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.bibledaily.app.MainActivity
import com.bibledaily.app.R
import com.bibledaily.app.data.Settings
import com.bibledaily.app.domain.Mirror
import java.time.LocalDateTime
import java.time.ZoneId

/** The optional daily reminder. Uses an inexact alarm, so it needs no special permission. */
object Reminder {
    private const val CHANNEL = "daily_reading"

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(ctx, 7, Intent(ctx, ReminderReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun schedule(ctx: Context, s: Settings) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pending(ctx))
        if (!s.reminderOn) return
        val now = LocalDateTime.now()
        var at = now.toLocalDate().atTime(s.reminderMinutes / 60, s.reminderMinutes % 60)
        if (!at.isAfter(now)) at = at.plusDays(1)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(), pending(ctx))
    }

    fun show(ctx: Context) {
        val m = Mirror.prefs(ctx)
        if (m.getBoolean("doneToday", false)) return
        val ref = m.getString("readingRef", "") ?: ""
        if (ref.isEmpty()) return
        val meta = (m.getString("readingMeta", "") ?: "").substringAfter("· ").replace("about ", "")
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Daily reading", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Today’s reading: $ref · $meta")
            .setContentIntent(open).setAutoCancel(true).build()
        runCatching { nm.notify(1, n) }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Reminder.show(ctx)
        val m = Mirror.prefs(ctx)
        Reminder.schedule(ctx, Settings(reminderOn = m.getBoolean("reminderOn", false), reminderMinutes = m.getInt("reminderMinutes", 450)))
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val m = Mirror.prefs(ctx)
        Reminder.schedule(ctx, Settings(reminderOn = m.getBoolean("reminderOn", false), reminderMinutes = m.getInt("reminderMinutes", 450)))
        com.bibledaily.app.widget.WidgetUpdater.scheduleMidnight(ctx)
    }
}
