# FastQue Assistant: voice conversation and main-screen navigation (issue #368)

## 1. Root causes of the owner's QA failures (master `f0aa6acb`)

Each layer was diagnosed separately, using the text the recognizer produced as the fixture.

| Symptom | Layer | Root cause | Fix |
|---|---|---|---|
| "व्हाट कैन यू डू", "हाउ कैन यू हेल्प मी", "What can you do?", "Tum kya kar sakte ho?" all got "Not understood" | **Parser (NLU)** | No help or greeting intent existed at all. English and Hinglish forms failed too, so this was not only a speech problem | New `app.help` intent (phase 8). The answer is built from the actions this user may run on this screen right now (role, screen, release gate) |
| "चेक करो कितनी चेयर्स अवेलेबल हैं" → Not understood, while "kitni chairs free hain" worked | **ASR + parser** | With `hi-IN` selected, Chrome writes ENGLISH words in Devanagari (चेयर्स = chairs, अवेलेबल = available). The parser only knew Latin "chairs" and the Hindi "कुर्सी" | `romanize()`: a fixed dictionary from Devanagari spellings of FastQue words to Latin. It is used as a second reading only when the sentence as written matches nothing, so existing Devanagari keywords and names are untouched |
| The chairs answer said "3 of 4 chairs in use" (it counted ACTIVE chairs) | **Answer** | "Available" was read as switched-on, not free right now | The chairs answer now uses live occupancy: a running service session or an open manual occupancy, the same rule as the Live Queue. Example: "1 of 3 working chairs are free right now, 2 busy" |
| The same six generic chips after every failure | **Server fallback** | `turn()` returned the first 6 SUPPORTED actions of the whole catalog, whatever was said | `notUnderstoodTurn()`: names what it heard (so a recognition mistake is visible), suggests the topic of the sentence, always offers "What can you do?", and varies by sentence |
| "Bookings kholo" showed a list inside the drawer; "Live queue kholo" listed the queue | **Parser + UI** | No navigation intent; the "Open" link sat inside the drawer | `app.navigate`: the server builds the route of the authorized shop from a fixed page map. The client opens it with the Next.js router on the MAIN screen and shrinks the assistant to a small bar |
| "wapas jao" (go back) parsed as **RESTORE A SERVICE** (a write) | **Parser** | "wapas" is an ACTIVATE word | `app.navigateBack`, matched first. The client goes back only along pages the assistant opened |
| One question per microphone tap; reply spoken only with a checkbox | **Client** | `use-speech.ts`: one-shot `continuous=false`, and `onend` just stopped | `VoiceConversation` state machine (below) |
| Toolbar cramped at ~420px | **UI** | Language select and "Read replies aloud" competed on one row | At ≤480px the tools stack. Measured at 420px: no horizontal overflow, 44px targets |

Before/after fixtures: `apps/backend/src/assistant/assistant-parser-phase8.spec.ts`.

## 2. Voice conversation state machine (`apps/web/lib/voice-conversation.ts`)

```
 off ──Start (after consent)──▶ listening ──final phrase──▶ understanding ──reply──▶ replying ──spoken──▶ listening …
                                  │  ▲                            │                       │
                                  │  └──── muted / no speech out ─┘ (skips replying)      └ Interrupt: stop speaking, listen now
                                  ├── silence ×3 / 90 s idle / restart storm ──▶ paused ──Resume──▶ listening
                                  ├── tab hidden ──────────────────────────────▶ paused (mic released)
                                  ├── mic denied / no mic / language unsupported ▶ error (mic released)
                                  ├── network error ───────────────────────────▶ paused
                                  ├── reply needs confirmation ────────────────▶ paused (decide on screen; voice never confirms)
                                  └── End / close / unmount / account switched off (404/401) ──▶ off
```

Safety properties, each with a unit test (`lib/__tests__/voice-conversation.test.jsx`):
- The mic opens only after the user presses Start and accepts the notice.
- The mic is **closed while a reply is spoken**, so the reply cannot be heard as a new question.
  Barge-in by voice is therefore not offered; Interrupt is a button.
- One request at a time. A generation counter drops late recognizer events and replies that arrive after Stop.
- A duplicate final phrase is sent once.
- A speaker that never reports "end" is moved on by a watchdog.
- No hidden mic: pause, end, unmount, a hidden tab and a revoked account all abort the recognizer.
  Paused never restarts on its own.
- Nothing is recorded or stored by FastQue. Audio goes to the browser's own recognizer (Chrome:
  Google), as the existing consent notice says. There is no paid STT/AI and no new server.

## 3. Browser support (honest)

| Browser | Mode |
|---|---|
| Chrome / Edge desktop, Chrome Android | **Hands-free** conversation (Web Speech recognition + speech output) |
| Browser with recognition but no speech output | Hands-free; replies are shown, not spoken |
| iPhone / iPad (Safari and in-app views) | **Push-to-talk only**: one tap per question. The panel says so instead of claiming hands-free |
| Firefox / no recognition | Typing only; the panel says so. The private FastQue voice server still works if configured |

Hindi/Hinglish recognition quality is the browser engine's. FastQue cannot improve the audio-to-text
step without a different STT provider, which would need owner approval. What FastQue now does:
- understands the Devanagari spellings that hi-IN produces;
- shows exactly what was heard, with an **Edit** button to correct it before resending;
- labels the first step "Speech → text", separate from "Understood".

## 4. Navigation on the main screen

- The server maps a page key (dashboard, queue, bookings, schedule, staff, team, services, chairs,
  settings, hours, offers, reviews, invoices, revenue, customers, analytics, cancellations, inventory,
  notifications, payments, photos, marketing, booking sources) to `/dashboard/salons/<authorized shop>/<page>`.
  - The action needs owner-or-admin access to that shop, checked before the route is built.
  - A different shop gets DENIED and no route.
- The client follows only `safeRoute()` paths, meaning this shop's pages or known signed-in areas.
  Another shop, `//host`, absolute URLs and query strings are refused.
- The page opens with `router.push`; the sidebar selection updates. The assistant docks as a small
  bar (status, caption or last reply, Interrupt/Pause/Resume/Mute/End, Expand). The shop layout keeps
  it mounted, so the conversation continues across pages of the same shop.
  - Leaving the shop, signing out or switching account ends it.
- Navigation grants nothing: each page still checks its own access.

## 5. Release gate and rollback

- No migrations or schema changes. No new environment variables. No paid services.
- Production stays as approved: `ASSISTANT_MODE=cohort`, the single Handsome Center owner in
  `ASSISTANT_COHORT_USER_IDS`, and `ASSISTANT_WRITES=off`. This PR does not change any of them.
- Deploy only with owner approval:
  1. merge commit to master;
  2. backend deploy, which must report 0 new migrations;
  3. web deploy pinned to the merge commit.
- Rollback: redeploy the previous backend and web deployments (master `f0aa6acb`). There is no
  data to undo.

## 6. Owner test script: Handsome Center, Chrome desktop or Android

Open FastQue → your shop → **Assistant** → **Start voice conversation** → Allow microphone.
Language: हिंदी / Hinglish. Do not tap the microphone again between questions.

1. **"What can you do?"** or **"Aap kya kya kar sakte ho?"**
   - Expect a spoken reply listing queue, bookings, free chairs, services and staff, and that changes are off.
2. **"चेक करो कितनी चेयर्स अवेलेबल हैं"**, said naturally as "check karo kitni chairs available hain".
   - Expect "X of Y working chairs are free right now…", matching the Chairs page.
3. **"Aaj queue mein kitne log hain?"**
   - Expect the waiting count.
4. **"Bookings kholo"**
   - Expect the main screen to change to Bookings. The assistant becomes a small bar and keeps listening.
5. **"Services page kholo"**, then **"wapas jao"**
   - Expect Services to open, then Bookings again.
6. **"Haircut ka price 150 karo"**
   - Expect "switched off… nothing was changed". No price changes.
7. Press **Mute**, ask **"Staff dikhao"**
   - Expect the answer on screen, not spoken.
8. While a reply is being spoken, press **Interrupt**
   - Expect speaking to stop and listening to start.
9. Switch to another tab and come back
   - Expect "Paused…". Press **Resume**.
10. Press **End conversation**
    - Expect the browser's mic indicator to switch off.

Note which browser and phone you used. If a phrase is misheard, tap **Edit** on it and send the
corrected text. That tells us whether the problem was recognition or understanding.
