# Issue #371: first-attempt recognition and audible replies

Two independent defects, diagnosed separately. Same browser-only providers as before: Web Speech
recognition and `speechSynthesis`. No paid service, no new server, no audio stored.

## 1. Spoken replies were not heard (TTS): root causes

Measured in a real Chromium 152 on Windows (the in-app browser), using the old `browserSpeaker`:

| Finding | Evidence | Effect |
|---|---|---|
| Push-to-talk replies were spoken only if "Read replies aloud" was ticked, and it was **off by default** | source | A question asked with the mic button got a silent reply |
| `getVoices()` returns **0** voices at first; the list arrives later via `voiceschanged` | measured | No voice was chosen; the browser default was used for `hi-IN` |
| This machine has **no Hindi voice** (3 en-US voices) | measured | Devanagari text "started" at 94 ms and "ended" at 120 ms: **26 ms of silence reported as success** |
| Time from `speak()` to `start` varied 80 ms–4.7 s (cold) | measured | The watchdog, counted from `speak()`, could reopen the mic and cancel a reply mid-sentence, or move on with no sound |
| A slow voice took 26 s for one 180-character chunk | measured after the first fix | An estimate-only watchdog queued the next chunk **twice**; fixed and regression-tested |

Fixes, in `apps/web/lib/speech-output.ts`:
- Waits for the voice list, then picks an installed voice for the language.
- Never sends Devanagari to a non-Hindi voice. It reports "no Hindi voice" instead.
- A reply counts as played only after `start` fires; the end is timed from `start`.
- The watchdog waits while the engine still reports `speaking`. Each chunk advances exactly once, with a hard cap.
- Long replies are spoken in chunks; the engine is resumed before speaking.
- `cancel` is only called when something is actually queued.
- Failures are visible, with a reason: blocked, never started, no voice, engine error. Each has a **Test speaker** link.
- Push-to-talk replies are spoken by default ("Speak replies to voice questions"). Mute still applies in a conversation.
- Voice settings:
  - a Hindi reply voice and an English reply voice (Automatic or any installed voice);
  - Test speaker buttons that report the voice that actually played;
  - an honest note when a Hindi voice is missing.

Device and tab volume are controlled by the user and the OS; FastQue cannot change them. The test
result therefore says "If you heard nothing, check the device volume and that this tab is not muted".

## 2. First-attempt recognition: layers separated

| Layer | Root cause | Fix |
|---|---|---|
| **Speech recognition (ASR)** | `maxAlternatives = 1`: only the top hypothesis was ever used | Up to 5 alternatives are sent with the confidence. The server uses an alternative **only for a read or navigation**. A change heard only in an alternative is offered as a "Did you mean" chip to tap, never run. |
| **Voice turn timing** | `continuous = false`: Chrome finalises on a short pause, so "bookings… kholo" could be sent as "bookings" | Continuous capture. The phrase is complete after 0.9 s of silence, and longer while words are still arriving. The mic is still closed before anything is sent or spoken. |
| **Mic timing** | "Listening" was shown before audio capture started, so the first syllables could be clipped | "Starting microphone… wait" until the browser's `audiostart`, then "Listening… speak now". The mic start time is shown in the voice check. |
| **Language** | One unexplained choice | The Hindi mode (hi-IN) and the English/Hinglish-in-English-letters mode (en-IN) are explained. Switching mid-conversation restarts the mic in the new language. The browser cannot auto-detect code-switching, and the UI says so. |
| **Intent (NLU)** | en-IN mis-spellings were not mapped: cheyars, kyu, servises, stuff, bukings, kolo… | A bounded whole-word alias list for reads and navigation only. Nothing maps INTO a change word. |
| **Feedback** | A misheard phrase looked like "not understood" | Each answer shows "Understood as: …" when an alternative was used. Edit (from #368) remains. |

## 3. Measurements

- **Parser on SIMULATED recognizer outputs** (`voice-asr-fixtures.ts`, 39 Hindi-script and en-IN mis-spelled
  forms; not the owner's recordings): master `a9d94265` **33/39** → this branch **39/39**.
  - These fixtures were written for this issue, so this measures parser resilience, not real first-try accuracy.
- **Acceptance set typed:** 32/32 phrases map to the expected action (enforced by a test).
- **Real browser:**
  - full loop with a scripted recognizer (only the audio is simulated), real backend and real `speechSynthesis`:
    1. heard → understood (alternative used) → audio started at 119 ms → mic reopened 456 ms after audio ended;
    2. a mis-spelled en-IN phrase was answered with live chairs data, spoken;
    3. "bookings kholo" changed the main screen and was spoken.
  - no playback errors; the mic was closed while every reply played.
- **Real first-attempt accuracy on the owner's microphone is NOT yet measured.** It needs the owner's voice:
  use **Check voice accuracy** in the Assistant. It shows "understood on the FIRST try X/32" next to the old
  "top transcript only" count from the same attempt, which is the before/after. Copy the summary; it contains
  counts and phrase ids only.

## 4. Owner acceptance checklist (after a separately approved canary deploy, Chrome)

1. Assistant → **Voice settings & speaker test** → **Test speaker (English)**.
   - Expect the sample to be heard, plus "Played with <voice>".
2. **Test speaker (Hindi)**.
   - Expect it to be heard, or the honest "No Hindi voice" note.
3. **Check voice accuracy**: say all 32 phrases once each.
   - Copy the summary into #371.
4. **Start voice conversation**.
   - Expect "Starting microphone… wait" first, then "Listening… speak now".
5. "What can you do?"
   - Expect the reply to be heard, then listening to start again with no tap.
6. "Kitni chairs free hain?"
   - Expect a spoken free/busy answer.
7. "Bookings kholo"
   - Expect the main screen on Bookings, the reply spoken, and listening again.
8. Change the language in **Voice settings** while listening.
   - Expect the mic to restart in the new language.
9. "Haircut ka price 150 karo"
   - Expect "switched off… nothing was changed". Nothing changes.
10. Mute, then a question.
    - Expect it on screen, not spoken.
    - Then Interrupt during a reply, then End conversation. Expect the browser's mic indicator to switch off.

Release: no migrations, no new environment variables. The rollout is unchanged (owner-only cohort,
`ASSISTANT_WRITES=off`). Rollback: redeploy master `a9d94265`.
