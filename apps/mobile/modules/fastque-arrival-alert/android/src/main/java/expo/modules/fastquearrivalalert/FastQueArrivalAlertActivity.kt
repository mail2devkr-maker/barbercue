package expo.modules.fastquearrivalalert

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * The full-screen "Has the customer arrived?" screen. Shown over the lock screen with the display
 * turned on by the arrival notification's full-screen intent.
 *
 * It decides nothing and changes nothing in the backend:
 *  - Arrived / Not arrived hand the owner to the existing React Native prompt (after unlocking), where
 *    the same two-step confirmation and idempotent backend calls apply.
 *  - Remind me in 2 minutes only schedules the phone's single re-alert.
 */
class FastQueArrivalAlertActivity : Activity() {
  private var payload: ArrivalAlertPayload? = null
  private val handler = Handler(Looper.getMainLooper())
  private val timeout = Runnable { finish() } // the notification (with its buttons) stays in the tray

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    if (!bind(intent)) finish()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (!bind(intent)) finish()
  }

  override fun onStart() {
    super.onStart()
    visible = true
  }

  override fun onStop() {
    visible = false
    super.onStop()
  }

  override fun onDestroy() {
    handler.removeCallbacks(timeout)
    super.onDestroy()
  }

  @Suppress("DEPRECATION")
  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    // Keep the display on while the decision is pending; it is released when this screen finishes.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun bind(intent: Intent?): Boolean {
    val raw = intent?.getStringExtra(ArrivalAlertNotifier.EXTRA_PAYLOAD) ?: return false
    val parsed = runCatching { ArrivalAlertPayload.fromJson(JSONObject(raw)) }.getOrNull() ?: return false
    payload = parsed
    setContentView(buildContent(parsed))
    handler.removeCallbacks(timeout)
    handler.postDelayed(timeout, SCREEN_TIMEOUT_MS)
    return true
  }

  private fun buildContent(p: ArrivalAlertPayload): View {
    val strings = ArrivalAlertStrings.forLang(p.lang)
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_VERTICAL
      setBackgroundColor(INK)
      setPadding(dp(28), dp(56), dp(28), dp(40))
    }
    root.addView(text(strings.eyebrow, 13f, GOLD, bold = true, letterSpacing = 0.12f))
    p.timeLabel()?.let { root.addView(text(it, 48f, Color.WHITE, bold = true, top = 16)) }
    p.serviceName?.let { root.addView(text(it, 20f, MUTED, top = 4)) }
    root.addView(text(strings.question, 30f, Color.WHITE, bold = true, top = 24))
    root.addView(text(strings.hint, 14f, MUTED, top = 12))

    root.addView(button(strings.arrived, ACCENT, Color.WHITE, top = 32) { openInApp(ArrivalAlertNotifier.ACTION_ARRIVED) })
    root.addView(button(strings.notArrived, Color.TRANSPARENT, Color.WHITE, top = 12, outlined = true) {
      openInApp(ArrivalAlertNotifier.ACTION_NOT_ARRIVED)
    })
    root.addView(button(strings.snooze, Color.TRANSPARENT, MUTED, top = 12, outlined = true) { snooze() })
    return root
  }

  private fun openInApp(action: String) {
    val p = payload ?: return
    val launch = {
      startActivity(ArrivalAlertNotifier.deepLinkIntent(this, p, action))
      ArrivalAlertNotifier.cancelNotification(this, p.bookingId)
      finish()
    }
    val keyguard = getSystemService(KeyguardManager::class.java)
    if (keyguard != null && keyguard.isKeyguardLocked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Business actions need the phone unlocked: ask the system to unlock, then open FastQue.
      keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          launch()
        }
      })
    } else {
      launch()
    }
  }

  private fun snooze() {
    val p = payload ?: return
    ArrivalAlertNotifier.scheduleSnooze(this, p)
    finish()
  }

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun text(
    value: String,
    sizeSp: Float,
    color: Int,
    bold: Boolean = false,
    top: Int = 0,
    letterSpacing: Float = 0f,
  ) = TextView(this).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    setTextColor(color)
    if (bold) typeface = Typeface.DEFAULT_BOLD
    if (letterSpacing != 0f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) this.letterSpacing = letterSpacing
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      .also { it.topMargin = dp(top) }
  }

  private fun button(
    label: String,
    fill: Int,
    textColor: Int,
    top: Int,
    outlined: Boolean = false,
    onClick: () -> Unit,
  ) = TextView(this).apply {
    text = label
    gravity = Gravity.CENTER
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
    setTextColor(textColor)
    typeface = Typeface.DEFAULT_BOLD
    minHeight = dp(56)
    background = GradientDrawable().apply {
      cornerRadius = dp(14).toFloat()
      setColor(fill)
      if (outlined) setStroke(dp(1), MUTED)
    }
    isClickable = true
    isFocusable = true
    contentDescription = label
    setOnClickListener { onClick() }
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      .also { it.topMargin = dp(top) }
  }

  companion object {
    private const val SCREEN_TIMEOUT_MS = 90_000L
    private val INK = Color.parseColor("#1C1A17")
    private val ACCENT = Color.parseColor("#B0413E")
    private val GOLD = Color.parseColor("#D9B26F")
    private val MUTED = Color.parseColor("#B9B2A6")

    /** True while this screen is in front of the owner (read by the messaging service). */
    @Volatile
    var visible: Boolean = false
  }
}
