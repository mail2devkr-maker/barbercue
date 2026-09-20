package expo.modules.fastquearrivalalert

import android.content.Context
import org.json.JSONObject

/**
 * Persistent per-booking alert episode state, so the native path is exactly-once even across process
 * death: a re-delivered push, a retried FCM message or a repeated refresh can never launch the screen
 * twice. Backed by SharedPreferences (a process-killed app must remember).
 *
 * An entry means "this booking has alerted in the current episode". An episode ends when the owner
 * snoozes and the snooze fires (a single re-alert), or when the booking stops being eligible
 * (reconcile / cancel). Backend truth stays authoritative: this only limits how often the phone
 * itself shouts.
 */
class ArrivalAlertStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * [jsSeen] is false while the phone alerted natively (app not in front) and React Native has not yet
   * been told - so when the app opens it stays silent for that episode instead of sounding it again.
   */
  data class Entry(
    val payload: ArrivalAlertPayload,
    val alertedAt: Long,
    val snoozedUntil: Long?,
    val jsSeen: Boolean = true,
  )

  /**
   * Atomically claims this booking's alert. Returns false when it already alerted (duplicate).
   * [jsSeen] is true when React Native is in front and handles this alert itself.
   */
  @Synchronized
  fun claim(payload: ArrivalAlertPayload, jsSeen: Boolean, now: Long = System.currentTimeMillis()): Boolean {
    val all = load(now)
    if (all.containsKey(payload.bookingId)) return false
    all[payload.bookingId] = Entry(payload, now, null, jsSeen)
    save(all)
    return true
  }

  @Synchronized
  fun get(bookingId: String, now: Long = System.currentTimeMillis()): Entry? = load(now)[bookingId]

  @Synchronized
  fun all(now: Long = System.currentTimeMillis()): List<Entry> = load(now).values.toList()

  /** Records a snooze (and remembers the payload, so the re-alert needs nothing from the network). */
  @Synchronized
  fun snooze(payload: ArrivalAlertPayload, until: Long, now: Long = System.currentTimeMillis()) {
    val all = load(now)
    val existing = all[payload.bookingId]
    all[payload.bookingId] = Entry(payload, existing?.alertedAt ?: now, until, existing?.jsSeen ?: true)
    save(all)
  }

  /**
   * The snooze fired: a fresh alert episode begins. Returns the payload to re-alert, once.
   * [jsSeen] is true when the app is in front and re-arms the prompt itself.
   */
  @Synchronized
  fun consumeSnooze(bookingId: String, jsSeen: Boolean, now: Long = System.currentTimeMillis()): ArrivalAlertPayload? {
    val all = load(now)
    val entry = all[bookingId] ?: return null
    if (entry.snoozedUntil == null) return null
    all[bookingId] = Entry(entry.payload, now, null, jsSeen)
    save(all)
    return entry.payload
  }

  /** Bookings that alerted natively and React Native has not been told about; marks them all told. */
  @Synchronized
  fun takeUnseenByJs(): List<String> {
    val all = load()
    val unseen = all.values.filter { !it.jsSeen }.map { it.payload.bookingId }
    if (unseen.isNotEmpty()) {
      for (id in unseen) all[id] = all.getValue(id).copy(jsSeen = true)
      save(all)
    }
    return unseen
  }

  @Synchronized
  fun remove(bookingId: String) {
    val all = load()
    if (all.remove(bookingId) != null) save(all)
  }

  /** Drops every entry of [salonId] whose booking is not in [eligibleBookingIds]; returns the dropped ids. */
  @Synchronized
  fun retainOnly(salonId: String, eligibleBookingIds: Set<String>): List<String> {
    val all = load()
    val dropped = all.values
      .filter { it.payload.salonId == salonId && it.payload.bookingId !in eligibleBookingIds }
      .map { it.payload.bookingId }
    if (dropped.isNotEmpty()) {
      dropped.forEach { all.remove(it) }
      save(all)
    }
    return dropped
  }

  private fun load(now: Long = System.currentTimeMillis()): MutableMap<String, Entry> {
    val result = LinkedHashMap<String, Entry>()
    val raw = prefs.getString(KEY, null) ?: return result
    val root = runCatching { JSONObject(raw) }.getOrNull() ?: return result
    val keys = root.keys()
    while (keys.hasNext()) {
      val id = keys.next()
      val item = root.optJSONObject(id) ?: continue
      val payload = ArrivalAlertPayload.fromJson(item.optJSONObject("payload") ?: continue) ?: continue
      val alertedAt = item.optLong("alertedAt", 0L)
      if (now - alertedAt > TTL_MS) continue // stale episode: forget it, a genuinely new one may alert
      val snoozedUntil = if (item.has("snoozedUntil")) item.optLong("snoozedUntil") else null
      result[id] = Entry(payload, alertedAt, snoozedUntil, item.optBoolean("jsSeen", true))
    }
    return result
  }

  private fun save(all: Map<String, Entry>) {
    val root = JSONObject()
    for ((id, entry) in all) {
      val item = JSONObject()
        .put("payload", entry.payload.toJson())
        .put("alertedAt", entry.alertedAt)
        .put("jsSeen", entry.jsSeen)
      if (entry.snoozedUntil != null) item.put("snoozedUntil", entry.snoozedUntil)
      root.put(id, item)
    }
    prefs.edit().putString(KEY, root.toString()).apply()
  }

  companion object {
    private const val PREFS = "fastque_arrival_alert_store"
    private const val KEY = "episodes"
    // An appointment's arrival window is short; a day-old episode is certainly over.
    private const val TTL_MS = 12L * 60 * 60 * 1000
  }
}
