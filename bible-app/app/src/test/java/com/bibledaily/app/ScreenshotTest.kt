package com.bibledaily.app

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.core.app.ApplicationProvider
import com.bibledaily.app.ui.BibleApp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Renders the real screens on the JVM so layout can be checked without an emulator. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h780dp-xxhdpi", application = Application::class)
class ScreenshotTest {
    @get:Rule val rule = androidx.compose.ui.test.junit4.createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val out = File(System.getProperty("shots") ?: "build/shots").apply { mkdirs() }

    private fun shot(name: String) {
        rule.mainClock.advanceTimeBy(2600)
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        val v = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(1080, 2340, Bitmap.Config.ARGB_8888)
        v.measure(android.view.View.MeasureSpec.makeMeasureSpec(1080, android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec(2340, android.view.View.MeasureSpec.EXACTLY))
        v.layout(0, 0, 1080, 2340)
        v.draw(android.graphics.Canvas(bmp))
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun tour() {
        rule.mainClock.autoAdvance = false
        val app = ApplicationProvider.getApplicationContext<Application>()
        val vm = AppViewModel(app)
        rule.setContent { BibleApp(vm) }
        var guard = 0
        while (vm.loaded == null && guard++ < 400) { Thread.sleep(50); rule.mainClock.advanceTimeBy(50) }
        rule.mainClock.advanceTimeBy(300)
        shot("00-onboarding")
        vm.update { it.copy(onboarded = true) }
        shot("01-today")
        vm.selectTab(Tab.Progress); shot("02-progress")
        vm.selectTab(Tab.Settings); shot("03-settings")
        rule.runOnUiThread { vm.selectTab(Tab.Today) }
        shot("03b-today-again")
        rule.runOnUiThread { vm.beginReading() }
        shot("04-reader")
        rule.runOnUiThread { vm.sheet = null }
        rule.runOnUiThread { vm.markRead(false) }; shot("05-done")
        rule.runOnUiThread { vm.openVerseOfDay() }; shot("06-verse-sheet")
    }
}
