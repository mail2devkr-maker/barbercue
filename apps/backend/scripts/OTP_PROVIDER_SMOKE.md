# 2Factor OTP1 — single-handset transport smoke (TEST ONLY)

**Scope:** DB-free and **local-only**; uses FastQue's real `TwoFactorOtpSender` code. It does not deploy a service, run Prisma, create auth challenges, verify an OTP, or certify a FastQue login. Running this test is **not** approval to enable production SMS.

## Stop conditions
- Require **written confirmation from 2Factor** that `OTP1` with sender `SULTNE` and the Southern Express text is authorized for the FastQue test and supports a **six-digit** manually supplied OTP. A dashboard showing “APPROVED” alone is insufficient.
- Use **one consented Indian handset**, never an existing customer number without permission.
- Keep the API key on the user's local machine in a transient process environment. Never post it to chat, commit it, add it to a screenshot, or pass it in a command-line argument.
- No automatic retries, no bulk send, no production Railway key, no shared Neon connection.
- It will reject Railway and CI execution. Provider acceptance is not proof of handset delivery.

## Windows PowerShell, from repository root

Install project dependencies using the project's normal setup, then:

```powershell
# DRY RUN: sends nothing, costs nothing.
npm run smoke:otp-provider --workspace=@barbercue/backend
```

Only **after** receiving written vendor template authorization:

```powershell
$env:OTP_PROVIDER_API_MODE = 'manual-v1'
$env:OTP_PROVIDER_TEMPLATE_NAME = 'OTP1'
$env:OTP_SMOKE_NUMBER_CONSENT = 'YES'
$env:OTP_SMOKE_PROVIDER_TEMPLATE_APPROVED = 'YES'
$env:OTP_SMOKE_PHONE = Read-Host 'Enter one consented +91 mobile (do not paste in chat)'
$secure = Read-Host 'Enter 2Factor API key (masked)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:OTP_PROVIDER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$env:OTP_SMOKE_SEND = 'SEND_EXACTLY_ONE_SMS'
npm run smoke:otp-provider --workspace=@barbercue/backend

# Remove the values from this shell after testing.
'OTP_PROVIDER_API_MODE','OTP_PROVIDER_TEMPLATE_NAME','OTP_SMOKE_NUMBER_CONSENT','OTP_SMOKE_PROVIDER_TEMPLATE_APPROVED','OTP_SMOKE_PHONE','OTP_PROVIDER_API_KEY','OTP_SMOKE_SEND' |
  ForEach-Object { Remove-Item ('Env:' + $_) -ErrorAction SilentlyContinue }
```

The program generates one random six-digit code without printing the code or the API key. If the request is accepted, the program reports only `PROVIDER_ACCEPTED`. Check the consented handset **outside** the terminal: arrival/no arrival, exactly six digits (leading zeros count), sender, wording, elapsed time, and vendor-delivery status. Mask codes and phone numbers in any evidence.

## Gate results

| Check | Proof |
|---|---|
| Adapter compiles/tests | Exact SHA CI status |
| Provider accepted request | `PROVIDER_ACCEPTED` only |
| Handset received SMS | Consented owner confirms reception, 6-digit text, and sender |
| DLT / shared template authorized | 2Factor written sign-off |
| FastQue OTP login works | **Not covered** — requires a safely migrated isolated DB and full app auth tests |

Do **not** pay for the 10,000-credit package or enable production solely because the provider returned `Success`. Keep the separate Neon test DB `fastque_otp_test` unchanged while migration `20260830215000_ensure_primary_platform_admin` is blocked. Never seed the hardcoded real administrator email as a fake placeholder or manually mark that migration as applied.
