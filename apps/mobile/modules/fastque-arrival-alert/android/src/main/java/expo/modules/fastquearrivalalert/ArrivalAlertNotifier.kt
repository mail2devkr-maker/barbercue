package expo.modules.fastquearrivalalert

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Posts (and cancels) the mandatory arrival notification. It is a HIGH-importance notification on its
 * own channel that carries a full-screen intent:
 *
 *  - Screen off / locked  -> Android launches [FastQueArrivalAlertActivity] over the lock screen and
 *    turns the display on (needs USE_FULL_SCREEN_INTENT; on Android 14+ a user-granted special access).
 *  - Full-screen not allowed, or the phone is unlocked and in use -> Android shows the very same
 *    notification as a heads-up with sound + vibration and Arrived / Not arrived / Remind actions.
 *
 * The heads-up fallback is deliberately persistent and expanded (big-text style with all three action
 * buttons showing, ongoing so a stray swipe cannot lose the decision) because that is the most Android
 * allows a non-core full-screen-intent app to do while another app is in active use. Nothing here uses
 * SYSTEM_ALERT_WINDOW / draw-over-other-apps, and FastQue is neither an alarm nor a calling app: it never
 * declares itself as one (no ALARM or CALL category).
 *
 * It obeys the phone: notification permission, the channel setting, ring volume and Do Not Disturb are
 * all still applied by the OS. Nothing here bypasses DND (no bypass-DND flag).
 */
object ArrivalAlertNotifier {
  const val CHANNEL_ID = "fastque-arrival-check"
  const val SNOOZE_MS = 2L * 60 * 1000
  const val ACTION_SNOOZE_NOW = "expo.modules.fastquearrivalalert.SNOOZE_NOW"
  const val ACTION_SNOOZE_FIRED = "expo.modules.fastquearrivalalert.SNOOZE_FIRED"
  const val EXTRA_BOOKING_ID = "bookingId"
  const val EXTRA_PAYLOAD = "payload"

  const val ACTION_OPEN = "open"
  const val ACTION_ARRIVED = "arrived"
  const val ACTION_NOT_ARRIVED = "not-arrived"

  private const val TAG = "FastQueArrivalAlert"
  // Failsafe only: the arrival window closes long before this, and every resolution path cancels the
  // notification itself. It just guarantees a stale one can never linger in the tray.
  private const val NOTIFICATION_TIMEOUT_MS = 30L * 60 * 1000
  private val VIBRATION = longArrayOf(0, 500, 250, 500, 250, 500)

  private fun notificationId(bookingId: String): Int = bookingId.hashCode()

  fun ensureChannel(context: Context, lang: String = "EN") {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val strings = ArrivalAlertStrings.forLang(lang)
    val channel = NotificationChannel(CHANNEL_ID, strings.channelName, NotificationManager.IMPORTANCE_HIGH).apply {
      description = strings.channelDescription
      enableVibration(true)
      vibrationPattern = VIBRATION
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
    }
    manager.createNotificationChannel(channel)
  }

  /** False when the owner turned FastQue notifications (or just this channel) off in system settings. */
  fun notificationsEnabled(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(CHANNEL_ID)
      if (channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE) return false
    }
    return true
  }

  /** Android 14+: a special access the owner grants; earlier versions: allowed by the manifest permission. */
  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
    return context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() ?: false
  }

  /**
   * True when a FastQue screen is in front of the owner - the React Native prompt owns the decision
   * then. The arrival screen itself doesn't count, so a re-delivered push while it is showing is
   * simply dropped instead of being re-rendered by another path.
   */
  fun isAppInForeground(context: Context): Boolean {
    if (FastQueArrivalAlertActivity.visible) return false
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  /** The React Native side handles this link: it opens the existing two-step arrival prompt. */
  fun deepLinkIntent(context: Context, payload: ArrivalAlertPayload, action: String): Intent {
    val uri = Uri.Builder()
      .scheme("fastque")
      .authority("arrival-check")
      .appendQueryParameter("salonId", payload.salonId)
      .appendQueryParameter("bookingId", payload.bookingId)
      .appendQueryParameter("action", action)
      .build()
    return Intent(Intent.ACTION_VIEW, uri)
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  private fun activityIntent(context: Context, payload: ArrivalAlertPayload): Intent =
    Intent(context, FastQueArrivalAlertActivity::class.java)
      .setData(Uri.parse("fastque://arrival-alert/${payload.bookingId}"))
      .putExtra(EXTRA_PAYLOAD, payload.toJson().toString())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

  private fun snoozeNowIntent(context: Context, payload: ArrivalAlertPayload): Intent =
    Intent(context, FastQueArrivalSnoozeReceiver::class.java)
      .setAction(ACTION_SNOOZE_NOW)
      .setData(Uri.parse("fastque://arrival-snooze-now/${payload.bookingId}"))
      .putExtra(EXTRA_BOOKING_ID, payload.bookingId)

  private fun snoozeFiredIntent(context: Context, bookingId: String): Intent =
    Intent(context, FastQueArrivalSnoozeReceiver::class.java)
      .setAction(ACTION_SNOOZE_FIRED)
      .setData(Uri.parse("fastque://arrival-snooze/$bookingId"))
      .putExtra(EXTRA_BOOKING_ID, bookingId)

  private const val IMMUTABLE_UPDATE = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

  /** Posts the notification. Returns false when nothing could be shown (notifications are off). */
  fun show(context: Context, payload: ArrivalAlertPayload): Boolean {
    val app = context.applicationContext
    ensureChannel(app, payload.lang)
    if (!notificationsEnabled(app)) return false
    val strings = ArrivalAlertStrings.forLang(payload.lang)
    val text = listOfNotNull(payload.timeLabel(), payload.serviceName).joinToString(" · ")

    val openPending = PendingIntent.getActivity(app, 0, deepLinkIntent(app, payload, ACTION_OPEN), IMMUTABLE_UPDATE)
    val arrivedPending =
      PendingIntent.getActivity(app, 0, deepLinkIntent(app, payload, ACTION_ARRIVED), IMMUTABLE_UPDATE)
    val notArrivedPending =
      PendingIntent.getActivity(app, 0, deepLinkIntent(app, payload, ACTION_NOT_ARRIVED), IMMUTABLE_UPDATE)
    val snoozePending = PendingIntent.getBroadcast(app, 0, snoozeNowIntent(app, payload), IMMUTABLE_UPDATE)

    val builder = NotificationCompat.Builder(app, CHANNEL_ID)
      .setSmallIcon(R.drawable.fastque_arrival_alert_icon)
      .setContentTitle(strings.question)
      .setContentText(text)
      .setSubText(strings.eyebrow)
      .setStyle(NotificationCompat.BigTextStyle().bigText(listOf(text, strings.hint).filter { it.isNotEmpty() }.joinToString("\n")))
      // A reminder, not an alarm: an ALARM category would punch through Do Not Disturb, and the
      // owner's phone settings must stay in charge.
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setOnlyAlertOnce(true)
      // Persistent: stays (with its buttons visible) until the owner acts, opens it, snoozes, or the
      // backend says the arrival is resolved. Tapping still dismisses it.
      .setOngoing(true)
      .setTimeoutAfter(NOTIFICATION_TIMEOUT_MS)
      .setAutoCancel(true)
      .setContentIntent(openPending)
      .addAction(0, strings.arrived, arrivedPending)
      .addAction(0, strings.notArrived, notArrivedPending)
      .addAction(0, strings.snooze, snoozePending)

    if (canUseFullScreenIntent(app)) {
      val fullScreen = PendingIntent.getActivity(app, 0, activityIntent(app, payload), IMMUTABLE_UPDATE)
      builder.setFullScreenIntent(fullScreen, true)
    }
    // else: graceful fallback - the same notification appears as a heads-up with sound + vibration and
    // the three actions; opening FastQue then reconciles with the backend and shows the full prompt.

    return try {
      NotificationManagerCompat.from(app).notify(notificationId(payload.bookingId), builder.build())
      true
    } catch (error: SecurityException) {
      Log.w(TAG, "Notification permission missing; arrival alert not shown", error)
      false
    }
  }

  fun cancelNotification(context: Context, bookingId: String) {
    NotificationManagerCompat.from(context.applicationContext).cancel(notificationId(bookingId))
  }

  /** Snooze: nothing changes in the backend; the phone re-alerts once when the time is up. */
  fun scheduleSnooze(context: Context, payload: ArrivalAlertPayload, delayMs: Long = SNOOZE_MS) {
    val app = context.applicationContext
    val until = System.currentTimeMillis() + delayMs
    ArrivalAlertStore(app).snooze(payload, until)
    val pending = PendingIntent.getBroadcast(app, 0, snoozeFiredIntent(app, payload.bookingId), IMMUTABLE_UPDATE)
    val alarms = app.getSystemService(AlarmManager::class.java)
    // Inexact-but-allowed-while-idle: needs no exact-alarm special access; Doze may delay it a little.
    alarms?.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, until, pending)
    cancelNotification(app, payload.bookingId)
  }

  fun cancelSnooze(context: Context, bookingId: String) {
    val app = context.applicationContext
    val pending = PendingIntent.getBroadcast(
      app, 0, snoozeFiredIntent(app, bookingId), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE,
    )
    if (pending != null) {
      app.getSystemService(AlarmManager::class.java)?.cancel(pending)
      pending.cancel()
    }
  }

  /** The booking is resolved / no longer eligible: nothing native may alert for it any more. */
  fun cancelAlert(context: Context, bookingId: String) {
    cancelNotification(context, bookingId)
    cancelSnooze(context, bookingId)
    ArrivalAlertStore(context).remove(bookingId)
  }
}
