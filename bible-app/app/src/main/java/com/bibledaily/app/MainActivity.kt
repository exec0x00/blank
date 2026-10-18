package com.bibledaily.app

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.animation.AnticipateInterpolator
import android.view.animation.PathInterpolator
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import com.bibledaily.app.ui.BibleApp
import com.bibledaily.app.ui.C

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { vm.loaded == null }
        // the splash icon drifts up and fades as the first screen settles in
        splash.setOnExitAnimationListener { provider ->
            val v = provider.view
            v.animate().alpha(0f).translationY(-v.height * 0.03f).scaleX(1.04f).scaleY(1.04f)
                .setDuration(380).setInterpolator(PathInterpolator(0.2f, 0f, 0f, 1f))
                .withEndAction { provider.remove() }.start()
        }
        enableEdgeToEdge(SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT), SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT))
        setContent {
            val view = LocalView.current
            val dark = C.p.dark
            SideEffect {
                val c = WindowCompat.getInsetsController(window, view)
                c.isAppearanceLightStatusBars = !dark
                c.isAppearanceLightNavigationBars = !dark
            }
            BibleApp(vm)
        }
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(i: Intent?) {
        if (i?.getBooleanExtra("open_verse", false) == true) {
            i.removeExtra("open_verse")
            window.decorView.post { vm.openVerseOfDay() }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.refreshDay()
    }
}
