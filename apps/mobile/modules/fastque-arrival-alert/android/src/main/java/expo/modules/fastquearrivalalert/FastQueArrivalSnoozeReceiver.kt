package expo.modules.fastquearrivalalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Two jobs, both about "Remind me in 2 minutes":
 *  - ACTION_SNOOZE_NOW  (notification button): record the snooze and schedule the single re-alert.
 *  - ACTION_SNOOZE_FIRED (the alarm): re-alert exactly once, then the snooze is spent.
 */
class FastQueArrivalSnoozeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val bookingId = intent.getStringExtra(ArrivalAlertNotifier.EXTRA_BOOKING_ID) ?: return
    if (!ArrivalAlertPayload.isValidId(bookingId)) return
    val store = ArrivalAlertStore(context)
    when (intent.action) {
      ArrivalAlertNotifier.ACTION_SNOOZE_NOW -> {
        val entry = store.get(bookingId) ?: return
        ArrivalAlertNotifier.scheduleSnooze(context, entry.payload)
      }
      ArrivalAlertNotifier.ACTION_SNOOZE_FIRED -> {
        // With FastQue open the React Native prompt re-arms itself; only wake the phone when it isn't.
        val foreground = ArrivalAlertNotifier.isAppInForeground(context)
        val payload = store.consumeSnooze(bookingId, jsSeen = foreground) ?: return // cancelled or spent
        if (foreground) return
        ArrivalAlertNotifier.show(context, payload)
      }
    }
  }
}
