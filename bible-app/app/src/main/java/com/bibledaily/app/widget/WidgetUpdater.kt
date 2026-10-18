package com.bibledaily.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDateTime

object WidgetUpdater {
    fun refresh(ctx: Context) {
        val app = ctx.applicationContext
        CoroutineScope(Dispatchers.Default).launch { runCatching { BibleWidget().updateAll(app) } }
    }

    /** One job just after local midnight, which then schedules the next. The verse itself is computed from the date. */
    fun scheduleMidnight(ctx: Context) {
        val now = LocalDateTime.now()
        val next = now.toLocalDate().plusDays(1).atTime(0, 2)
        val req = OneTimeWorkRequestBuilder<MidnightWorker>().setInitialDelay(Duration.between(now, next)).build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork("widget-midnight", ExistingWorkPolicy.REPLACE, req)
    }
}

class MidnightWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        runCatching { BibleWidget().updateAll(applicationContext) }
        WidgetUpdater.scheduleMidnight(applicationContext)
        return Result.success()
    }
}
