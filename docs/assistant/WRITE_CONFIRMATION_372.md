# Issue #372: mandatory confirmation for every Assistant write

Applies to all 48 current write actions and to any future one. A test fails if a catalog WRITE is
added without `confirm: true`.

## How a change happens (server-enforced, not UI decoration)

1. **First command → preview only.**
   - The handler runs with **read-only services**. Any data-changing method (`create*`, `update*`,
     `set*`, `cancel*`…, and Prisma `create/update/delete/$transaction`) throws before reaching the database.
   - The result must be a sealed preview, a question for a missing detail, or a refusal. A preview that
     claims a change, or asks to confirm without a sealed token, is refused.
2. **Unclear target → a question, no token.**
   - "staff hatao" with two staff, or "chair band karo" with two chairs, asks which one. Targets are
     never guessed.
3. **The preview** shows:
   - the plain question, e.g. "Kya aap sach mein Chair 2 ko hatana (Off) chahte hain?" or
     "Kya aap Haircut ki price ₹100 se ₹150 karna chahte hain?";
   - **Before → After** and the consequence;
   - "Abhi kuch bhi change nahi hua hai".
   - In a voice conversation the question is spoken, and the conversation **pauses** for the on-screen decision.
4. **High-risk changes** need an extra on-screen "Main samajhta/samajhti hoon" tick. The server refuses
   Confirm without it and keeps the token usable.
   - High-risk changes are deactivate/remove (chairs, staff, services), price, shop and staff hours,
     queue cancel/no-show, booking cancel/reschedule/no-show/correction, offer pause, shop profile and
     auto-assign.
   - Remove / deactivate is never a permanent delete, and the warning says so.
5. **Confirm** re-checks everything at that moment:
   - the token's signature, user, expiry and single use;
   - the release gate;
   - the shop and action allowlist;
   - roles and shop ownership;
   - the record's state as shown. For chairs, staff and prices this now includes the displayed name,
     so a renamed record is refused.
   - Any mismatch changes nothing.
6. **"haan / yes / ok / हाँ" is never a confirmation.** It answers: "Badlav sirf screen par Confirm
   button dabane se hota hai… Kuch bhi change nahi hua."
7. **Cancel** → "Cancelled, kuch bhi change nahi hua. (Nothing was changed.)"
8. **Refused or disabled** → "Editing is disabled for this testing account; nothing was changed", with
   a chip that opens the page where the owner can make the change by hand.

## Who may edit: default DENY

| Variable | Meaning | Production today |
|---|---|---|
| `ASSISTANT_WRITES` | `off` / `cohort` / `all` (unchanged) | `off` |
| `ASSISTANT_WRITE_SALON_IDS` | shop UUIDs where Assistant edits are allowed | **unset = no shop** |
| `ASSISTANT_WRITE_ACTIONS` | action ids that may be edited, e.g. `chairs.setStatus` | **unset = no action** |

`ASSISTANT_WRITES` alone no longer opens any edit. `*` means "any". It is for disposable test
databases only and must never be set in production.

A future Handsome Center canary, only with separate owner approval of the exact SHA and the named actions:

```
ASSISTANT_WRITES=cohort
ASSISTANT_WRITE_SALON_IDS=<Handsome Center salon id>
ASSISTANT_WRITE_ACTIONS=chairs.setStatus
```

Start with the reversible chair status. Add `services.setPrice` / `staff.setStatus` one at a time.

## Evidence

- **Backend unit:** policy spec, covering every write's `confirm`, the question builder, "haan/yes"
  and the read-only guard; allowlist unit tests.
- **Backend e2e** (`assistant-write-confirm372`): question text, high-risk acknowledgement and
  reuse of the token, single use, cancel, price question, unclear staff and chair, "haan", the
  owner's other shop, a non-allowlisted action, another owner, a stolen token, stale state, a forged
  token, and reads never entering the write flow.
- **The whole Assistant e2e suite** (100 tests) passes with read-only previews, so no write preview
  touches data.
- **Web:** Confirm disabled until "I understand" is ticked; `acknowledged` is sent only for high
  risk; the cancel message; a refused acknowledgement keeps the preview usable.

Rollback: redeploy master. No migrations.
