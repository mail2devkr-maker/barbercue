package expo.modules.fastquearrivalalert

import android.content.Context
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * The ONE audible part of a native arrival alert: a spoken announcement ("Appointment reminder. Has the
 * 6:30 PM Haircut customer arrived? Please confirm arrived or not arrived.") - the same sentence the web
 * dashboard and the shared VoiceAnnouncements dictionary use. If speech is not possible on this phone
 * (no TTS engine, or Hindi requested with no Hindi voice - Hindi text is never read with an English voice)
 * it falls back to the phone's default notification tone instead. Exactly one of the two plays per alert
 * episode; the notification itself lives on a channel with no sound of its own (see ArrivalAlertNotifier),
 * so nothing else makes noise and a channel that an OEM skin silenced cannot swallow the alert.
 *
 * Both use USAGE_NOTIFICATION audio attributes, so the phone's notification volume, silent / vibrate ringer
 * and Do Not Disturb apply exactly as they would to a notification sound. If the owner (or the phone)
 * lowered the arrival channel below HIGH importance, nothing is played at all.
 */
object ArrivalAlertVoice {
  private const val TAG = "FastQueArrivalAlert"
  private const val FAILSAFE_MS = 25_000L
  private const val TONE_MS = 4_000L
  // A cold Google TTS engine can take a few seconds to answer (seen: >6 s on a loaded x86 emulator, ~3 s warm).
  private const val ENGINE_START_MS = 8_000L

  private val main = Handler(Looper.getMainLooper())

  // Held only while an utterance is in flight, so the engine is never leaked or spoken over.
  private var engine: TextToSpeech? = null

  fun announce(context: Context, payload: ArrivalAlertPayload) {
    val app = context.applicationContext
    if (ArrivalAlertNotifier.channelAlertsMuted(app)) {
      Log.i(TAG, "voice skipped: the arrival channel was turned down on this phone")
      return
    }
    val text = ArrivalAlertStrings.forLang(payload.lang).spokenAnnouncement(payload.timeLabel(), payload.serviceName)
    val wakeLock = (app.getSystemService(Context.POWER_SERVICE) as? PowerManager)
      ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fastque:arrival-voice")
      ?.apply { setReferenceCounted(false) }
    runCatching { wakeLock?.acquire(FAILSAFE_MS) }
    main.post { speakOrTone(app, payload, text, wakeLock) }
  }

  private fun speakOrTone(app: Context, payload: ArrivalAlertPayload, text: String, wakeLock: PowerManager.WakeLock?) {
    fun release() = runCatching { if (wakeLock?.isHeld == true) wakeLock.release() }
    var settled = false
    fun fallToTone(reason: String) {
      if (settled) return
      settled = true
      Log.i(TAG, "voice unavailable ($reason); playing the default notification tone for booking=${payload.bookingId}")
      shutdownEngine()
      playTone(app)
      main.postDelayed({ release() }, TONE_MS)
    }

    try {
      engine?.let { runCatching { it.shutdown() } }
      var created: TextToSpeech? = null
      created = TextToSpeech(app) { status ->
        // A cold engine can answer after the fallback tone already started: never speak on top of it.
        if (settled) return@TextToSpeech
        val tts = created
        if (tts == null || status != TextToSpeech.SUCCESS) return@TextToSpeech fallToTone("engine init status=$status")
        val locale = if (payload.lang == "HI") Locale("hi", "IN") else Locale("en", "IN")
        val availability = tts.setLanguage(locale)
        if (availability == TextToSpeech.LANG_MISSING_DATA || availability == TextToSpeech.LANG_NOT_SUPPORTED) {
          // English may use the engine's own default voice; Hindi text is never read by an English voice.
          if (payload.lang == "HI") return@TextToSpeech fallToTone("no Hindi voice")
          if (tts.setLanguage(Locale.ENGLISH) < TextToSpeech.LANG_AVAILABLE) return@TextToSpeech fallToTone("no English voice")
        }
        tts.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {
            settled = true
            Log.i(TAG, "spoken announcement started booking=${payload.bookingId} lang=${payload.lang}")
          }

          override fun onDone(utteranceId: String?) {
            main.post {
              shutdownEngine()
              release()
            }
          }

          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String?) {
            main.post { fallToTone("utterance error") }
          }
        })
        val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "arrival-${payload.bookingId}")
        if (result != TextToSpeech.SUCCESS) fallToTone("speak() returned $result")
      }
      engine = created
      // An engine that never answers must not leave the alert silent.
      main.postDelayed({ if (!settled && engine === created) fallToTone("engine did not start in time") }, ENGINE_START_MS)
    } catch (error: Throwable) {
      Log.w(TAG, "speech failed", error)
      fallToTone("exception ${error.javaClass.simpleName}")
    }
  }

  private fun shutdownEngine() {
    engine?.let { runCatching { it.stop(); it.shutdown() } }
    engine = null
  }

  private fun playTone(app: Context) {
    try {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return
      val ringtone: Ringtone = RingtoneManager.getRingtone(app, uri) ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ringtone.audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      } else {
        @Suppress("DEPRECATION")
        ringtone.streamType = android.media.AudioManager.STREAM_NOTIFICATION
      }
      ringtone.play()
      main.postDelayed({ runCatching { ringtone.stop() } }, TONE_MS)
    } catch (error: Throwable) {
      Log.w(TAG, "fallback tone failed", error)
    }
  }
}
