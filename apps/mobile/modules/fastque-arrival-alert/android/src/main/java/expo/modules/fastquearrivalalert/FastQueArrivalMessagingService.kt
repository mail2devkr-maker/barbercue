package expo.modules.fastquearrivalalert

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Receives every FCM message for the app (higher priority than expo-notifications' own service, which
 * this extends) so the mandatory arrival prompt can wake the phone even when the app process was killed
 * or the screen is off. FCM starts the app process for a high-priority message and calls this service.
 *
 * Only `booking.arrival_check` is handled here; every other push goes straight to Expo untouched.
 */
class FastQueArrivalMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val payload = runCatching { ArrivalAlertPayload.fromFcmData(remoteMessage.data) }.getOrNull()
    if (payload == null) {
      super.onMessageReceived(remoteMessage)
      return
    }

    val foreground = ArrivalAlertNotifier.isAppInForeground(this)
    // One alert episode per booking: a re-delivered push never launches the screen twice.
    val claimed = ArrivalAlertStore(this).claim(payload, jsSeen = foreground)

    // App open in front of the owner: React Native shows its own prompt (and decides sound) through
    // Expo's normal path, so hand it over.
    if (foreground) {
      super.onMessageReceived(remoteMessage)
      return
    }

    if (!claimed) return
    val shown = try {
      ArrivalAlertNotifier.show(this, payload)
    } catch (error: Throwable) {
      Log.e(TAG, "Native arrival alert failed; falling back to the standard notification", error)
      super.onMessageReceived(remoteMessage)
      return
    }
    if (!shown) Log.w(TAG, "Arrival alert not shown: notifications are turned off for FastQue")
  }

  private companion object {
    const val TAG = "FastQueArrivalAlert"
  }
}
