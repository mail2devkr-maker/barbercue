# FastQue Action Assistant — design, security and coverage (issue #362)

Status: **Draft PR, not deployed.** Branch `claude/fastque-action-assistant-362`, based on master `f4f15e98`.
It is independent of R7 (#357) and R8 (#358) and touches neither.

## 1. What it is

The FastQue Assistant is a signed-in drawer, typed or spoken in Hindi, English or Hinglish. It turns one request into **one allowlisted, typed action**, runs it as the signed-in user through FastQue's existing services, and shows each stage on screen:

- Heard
- Understood
- Previewed
- Confirmed
- Saved by FastQue

It does not answer FAQs, and it does not let a model call APIs.

```
browser (drawer)                         backend (AssistantModule)
 typed / spoken text ──POST /assistant/turns──► interpreter (rules | optional local model)
                                                 │  → one intent from a fixed schema, or nothing
                                                 ▼
                                               authorize: session roles + shop ownership/membership
                                                 ▼
                         read  ◄─────────────── existing service (staff/services/queue/insights/search)
                         write ◄── preview + sealed confirmation (nothing changed yet)
 Confirm ──POST /assistant/confirmations──► re-authorize · verify seal · re-check before-state
                                                 ▼
                                               existing service write (its own audit + checks)
 ◄── DONE + refresh:[services] ───────────────  assistant audit row (append-only)
 page reloads from the API (never from the reply)
```

## 2. Security model

| Threat | Control |
|---|---|
| A model or text picks the user, role or shop | The interpreter output schema has no user, role or shop fields, and unknown keys are dropped. The user comes from the JWT. The shop is a UI hint, checked with `assertOwnerOrAdminAccess` / `assertAccessOrAdminAccess` at preview **and again at execution**. |
| Privilege escalation across roles | A per-action role allowlist in `ASSISTANT_ACTIONS`. The existing service still applies its own gate. E2E: another shop's owner, the platform viewer and a customer are all denied and audited. |
| Prompt injection (customer names, service names, reviews, model output) | Names are matched as data against the shop's own rows. Tool output is never fed back to a model. The local model gets one user message and must return one schema-valid intent; anything else falls back to the rules. E2E covers a service named as an instruction. |
| Replay or double execution | The confirmation is HMAC-sealed to user, shop, action, payload and a **before-state fingerprint**. It is single-use and expires after 120 s. Execution re-reads the row and refuses if it changed. E2E covers replay, a stale preview and a stolen token. |
| Confirmation surviving an account or shop switch | The token is bound to the user; the drawer clears its history when the shop changes; execution re-authorizes. |
| Destructive actions | Remove = archive (`isActive=false`), restorable. Staff remove = deactivate. Bulk delete, permissions, money, payouts, invites and publishing are **not** in the allowlist. |
| Abuse | 30 requests/min per route (throttler), 500-character limit, Zod validation, sign-in required. |
| Privacy | Audit rows hold the action, stage, outcome, changed entity ids and preview rows; **no transcript text**. Phones are masked in previews. No secrets are written to the transcript or tests. |
| Fake success | The UI shows "Saved by FastQue" only when the server returns `DONE` with `changed`. Network and server errors say "Nothing was changed." |

Everything fails closed:
- An unknown action is refused.
- A local-model error falls back to the rules.
- No shop selected means the action needs input.
- A server refusal is reported as not applied.

## 3. Interpreter: provider-independent

| Option | Status | Cost | Privacy | Notes |
|---|---|---|---|---|
| **Rules** (`ASSISTANT_INTERPRETER` unset) | Default, built | ₹0 | Nothing leaves FastQue | Deterministic English, Devanagari Hindi and Romanized Hinglish. Covers the owner examples in #362 and is unit-tested. |
| **Local model** (`ASSISTANT_INTERPRETER=local`, `ASSISTANT_LOCAL_MODEL_URL`, `ASSISTANT_LOCAL_MODEL`) | Built, **off** | Hardware only | Stays on your own server | Any OpenAI-compatible server: Ollama, llama.cpp `server`, vLLM. Suggested model: `qwen2.5:7b-instruct` or Llama 3.1 8B Instruct (Hindi capable). Needs about 8 GB RAM on CPU, faster on GPU. The URL **must** be loopback, RFC1918, `*.local` or `*.railway.internal`. JSON-only output, temperature 0, 4 s timeout, then the rules. |
| Paid cloud (Gemini, OpenAI, Anthropic) | **Not implemented** | Metered | Text leaves FastQue | Gemini stays disabled (owner decision). Adding one would need owner approval for spend and privacy. |

The model only chooses the intent and its slots. Matching to real rows, authorization, the preview and execution are identical for both interpreters.

**Open owner decision:** where to host a local model, if one is wanted. A Railway service adds cost; an office PC is another option.

## 4. Voice

- **Speech-to-text, now:** the browser's Web Speech API, `hi-IN` or `en-IN`, push-to-talk. If the browser has none (Firefox, some iOS webviews) or the microphone is refused, the mic is hidden or explains why, and typing always works.
  - **Privacy:** in Chrome this recognizer is Google's cloud service. It costs FastQue nothing, but the audio goes to Google.
  - **Local option:** a self-hosted `whisper.cpp` server behind the same `useSpeechInput` shape, so no audio leaves FastQue. Owner decision.
- **Text-to-speech:** the browser's `speechSynthesis`, off by default ("Read replies aloud" toggle), on-device on most systems.

## 5. Coverage matrix

The full route inventory is in [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md), generated from the controllers: 314 routes, 27 modules. Assistant coverage by role:

| Role | Action | Assistant | Confirm | Test gate | Live? |
|---|---|---|---|---|---|
| Owner / delegated admin | List staff | ✅ built | — | e2e | not deployed |
| Owner / delegated admin | Add staff (name, mobile) | ✅ built | yes | e2e | not deployed |
| Owner / delegated admin | Activate / deactivate staff | ✅ built | yes | e2e | not deployed |
| Owner / delegated admin | List services | ✅ built | — | e2e | not deployed |
| Owner / delegated admin | Add service | ✅ built | yes | e2e | not deployed |
| Owner / delegated admin | Price set, ±%, ±₹ | ✅ built | yes | e2e (exactly once, stale, replay) | not deployed |
| Owner / delegated admin | Archive / restore service | ✅ built | yes | e2e | not deployed |
| Owner / staff / admin | Live queue status | ✅ built | — | e2e | not deployed |
| Owner / delegated admin | Today's sales / summary | ✅ built (existing deterministic insights) | — | e2e | not deployed |
| Any signed-in | Find salons by service and city | ✅ built | — | unit | not deployed |
| Owner | Inventory (stock add, products, reports) | ⛔ UNAVAILABLE until R7 is live | yes | — | R7 not deployed |
| Employee / admin | Salon onboarding status | ⛔ UNAVAILABLE until R8 is live | — | — | R8 not deployed |
| Owner | Operating hours, chairs, photos, profile, payment QR | Phase 2 | yes | — | — |
| Owner / staff | Queue operations (call, assign, complete, no-show) | Phase 2 | yes for no-show and cancel | — | — |
| Owner | Bookings: list, reschedule, cancel | Phase 2 | yes | — | — |
| Owner | Offers, invoices, revenue reports, CSV | Phase 3 | yes | — | — |
| Staff | My assigned queue and appointments | Phase 2 (read) | — | — | — |
| Customer | Book appointment, join queue, my status, cancel, favorites | Phase 2 | yes for book and cancel | — | — |
| Field employee | Leads, follow-ups, onboarding drafts | Phase 3 (after R8) | yes | — | — |
| Platform admin / co-founder | Analytics, verification queue | Phase 3 (read first) | yes for decisions | — | — |
| Platform viewer | Read-only analytics | Phase 3 | never writes | e2e denial now | — |
| — | Bulk delete, roles and permissions, payouts, payments, OTP and DLT settings | **Never** via the assistant | — | — | — |

Adding an action means four steps:
1. An entry in `ASSISTANT_ACTIONS` (roles, access, read/write, examples).
2. An intent shape in `assistant-parser.ts` and `intentSchema`.
3. A `plan` case: read, or seal a preview.
4. An `execute` case that calls the existing service and checks the before-state, plus one e2e scenario.

## 6. Mobile

The Android work belongs to Codex (1.0.7). The assistant is mobile-ready because the contract is plain HTTP and shared types: `ASSISTANT_PATHS`, `AssistantTurnDto`, and the turns and confirmations endpoints. No `apps/mobile` file is changed. A coordination note for Codex is the next step; Codex's branch is not edited.

## 7. Release gates (not passed yet)

1. Owner review of this PR. CI must be green at the exact head.
2. Decide the voice provider (browser speech or local Whisper) and whether to host a local model.
3. Deployment: backend plus pinned web, no migration, after R7/R8 per the release order.
4. Runtime: a synthetic QA salon on production with a real owner session, typed **and** spoken, on a physical phone and a desktop (PHYSICAL).
