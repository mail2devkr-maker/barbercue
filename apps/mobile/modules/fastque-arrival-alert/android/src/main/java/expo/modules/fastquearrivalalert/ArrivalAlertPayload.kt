package expo.modules.fastquearrivalalert

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The only data the native arrival screen ever holds: IDs plus the appointment time and service name
 * that the backend put in the push. There is deliberately no customer name, phone or e-mail here - the
 * push never carries them, and the React Native prompt fetches everything else from the backend.
 */
data class ArrivalAlertPayload(
  val salonId: String,
  val bookingId: String,
  val slotStart: String?,
  val serviceName: String?,
  val lang: String,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("salonId", salonId)
    .put("bookingId", bookingId)
    .put("slotStart", slotStart)
    .put("serviceName", serviceName)
    .put("lang", lang)

  /** "10:30 am" in the device's own time zone, matching what the React Native prompt shows. */
  fun timeLabel(): String? {
    val iso = slotStart ?: return null
    val millis = parseIso(iso) ?: return null
    return SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(millis))
  }

  companion object {
    const val TYPE = "booking.arrival_check"
    private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")

    fun isValidId(value: String?): Boolean = value != null && ID.matches(value)

    /** Expo push puts the developer `data` JSON into the FCM `body` key. Returns null for any other push. */
    fun fromFcmData(data: Map<String, String>): ArrivalAlertPayload? {
      val nested = data["body"]?.let { runCatching { JSONObject(it) }.getOrNull() }
      if (nested != null && nested.optString("type") == TYPE) return fromJson(nested)
      if (data["type"] == TYPE) return fromJson(JSONObject(data))
      return null
    }

    fun fromJson(obj: JSONObject): ArrivalAlertPayload? {
      val salonId = obj.optString("salonId")
      val bookingId = obj.optString("bookingId")
      if (!isValidId(salonId) || !isValidId(bookingId)) return null
      return ArrivalAlertPayload(
        salonId = salonId,
        bookingId = bookingId,
        slotStart = obj.optString("slotStart").takeIf { it.isNotEmpty() },
        serviceName = obj.optString("serviceName").takeIf { it.isNotEmpty() }?.take(80),
        lang = if (obj.optString("lang").equals("HI", ignoreCase = true)) "HI" else "EN",
      )
    }

    private fun parseIso(iso: String): Long? {
      for (pattern in arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
        val format = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val parsed = runCatching { format.parse(iso) }.getOrNull()
        if (parsed != null) return parsed.time
      }
      return null
    }
  }
}

/** EN / HI copy for the native screen and notification, chosen by the `lang` the backend sent. */
class ArrivalAlertStrings private constructor(
  val channelName: String,
  val channelDescription: String,
  val eyebrow: String,
  val question: String,
  val arrived: String,
  val notArrived: String,
  val snooze: String,
  val hint: String,
) {
  companion object {
    fun forLang(lang: String): ArrivalAlertStrings = if (lang == "HI") HI else EN

    private val EN = ArrivalAlertStrings(
      channelName = "Arrival confirmation",
      channelDescription = "Required shop alert: has the customer arrived for their appointment?",
      eyebrow = "Appointment arrival check",
      question = "Has the customer arrived?",
      arrived = "Arrived",
      notArrived = "Not arrived",
      snooze = "Remind me in 2 minutes",
      hint = "You will confirm inside FastQue before anything changes.",
    )

    private val HI = ArrivalAlertStrings(
      channelName = "आगमन पुष्टि",
      channelDescription = "ज़रूरी दुकान अलर्ट: क्या ग्राहक अपॉइंटमेंट के लिए आ गया है?",
      eyebrow = "अपॉइंटमेंट आगमन जांच",
      question = "क्या ग्राहक आ गया है?",
      arrived = "आ गए",
      notArrived = "अभी नहीं आए",
      snooze = "2 मिनट बाद याद दिलाएं",
      hint = "कुछ भी बदलने से पहले आप FastQue के अंदर पुष्टि करेंगे।",
    )
  }
}
