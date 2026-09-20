package expo.modules.fastquearrivalalert

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * JS bridge for the native arrival alert. Everything here is a thin wrapper over the same store and
 * notifier the messaging service uses; it never talks to the backend and never mutates a booking.
 */
class FastQueArrivalAlertModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FastQueArrivalAlert")

    // Setup / readiness for the Settings screen and the owner banner.
    Function("getReadiness") {
      val ctx = context
      ArrivalAlertNotifier.ensureChannel(ctx)
      mapOf(
        "sdkInt" to Build.VERSION.SDK_INT,
        "notificationsEnabled" to ArrivalAlertNotifier.notificationsEnabled(ctx),
        "fullScreenIntentAllowed" to ArrivalAlertNotifier.canUseFullScreenIntent(ctx),
        // Android 14+ lets the owner revoke it, so FastQue must guide them to grant it.
        "fullScreenIntentNeedsUserGrant" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE),
      )
    }

    Function("openFullScreenIntentSettings") {
      val ctx = context
      val target = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}"))
      } else {
        notificationSettingsIntent(ctx)
      }
      launchSettings(ctx, target)
    }

    Function("openNotificationSettings") {
      val ctx = context
      launchSettings(ctx, notificationSettingsIntent(ctx))
    }

    // The RN prompt took over (or the booking was resolved / is no longer eligible).
    Function("dismissNotification") { bookingId: String ->
      if (ArrivalAlertPayload.isValidId(bookingId)) ArrivalAlertNotifier.cancelNotification(context, bookingId)
    }

    Function("cancelAlert") { bookingId: String ->
      if (ArrivalAlertPayload.isValidId(bookingId)) ArrivalAlertNotifier.cancelAlert(context, bookingId)
    }

    // The RN prompt's own "Remind me in 2 minutes": the phone re-alerts once even if the JS timer is asleep.
    Function("scheduleSnooze") { salonId: String, bookingId: String, slotStart: String?, serviceName: String?, lang: String? ->
      val payload = ArrivalAlertPayload.fromJson(
        JSONObject()
          .put("salonId", salonId)
          .put("bookingId", bookingId)
          .put("slotStart", slotStart ?: "")
          .put("serviceName", serviceName ?: "")
          .put("lang", lang ?: "EN"),
      )
      if (payload != null) ArrivalAlertNotifier.scheduleSnooze(context, payload)
    }

    // Backend truth says these are the only eligible arrivals for the salon: forget the rest.
    Function("reconcile") { salonId: String, eligibleBookingIds: List<String> ->
      val dropped = ArrivalAlertStore(context).retainOnly(salonId, eligibleBookingIds.toSet())
      dropped.forEach {
        ArrivalAlertNotifier.cancelNotification(context, it)
        ArrivalAlertNotifier.cancelSnooze(context, it)
      }
    }

    // What the phone alerted on its own since the app was last in front (returned once) and which
    // snoozes are pending, so the JS prompt neither re-sounds an alert nor ignores a snooze.
    Function("getNativeState") {
      val store = ArrivalAlertStore(context)
      val alerted = JSONArray()
      store.takeUnseenByJs().forEach { alerted.put(it) }
      val snoozes = JSONObject()
      for (entry in store.all()) {
        entry.snoozedUntil?.let { snoozes.put(entry.payload.bookingId, it) }
      }
      JSONObject().put("alerted", alerted).put("snoozes", snoozes).toString()
    }
  }

  private fun notificationSettingsIntent(ctx: Context): Intent =
    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)

  private fun launchSettings(ctx: Context, intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      ctx.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }
}
