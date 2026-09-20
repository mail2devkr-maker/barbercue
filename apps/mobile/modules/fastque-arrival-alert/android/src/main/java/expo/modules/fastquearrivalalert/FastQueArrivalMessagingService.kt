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
    Log.i(TAG, "arrival push received booking=${payload.bookingId} foreground=$foreground firstDelivery=$claimed")

    // App open in front of the owner: the React Native prompt is already (or is about to be) on screen,
    // driven by the realtime event / backend refresh, and it makes the one sound. The arrival push is
    // data-only (no title/body), so handing it to Expo would only produce an empty banner - swallow it.
    if (foreground) return

    if (!claimed) return
    val shown = try {
      ArrivalAlertNotifier.show(this, payload)
    } catch (error: Throwable) {
      Log.e(TAG, "Native arrival alert failed", error)
      false
    }
    if (!shown) Log.w(TAG, "Arrival alert NOT shown for booking=${payload.bookingId}: notifications are off for FastQue or the post failed")
  }

  private companion object {
    const val TAG = "FastQueArrivalAlert"
  }
}
