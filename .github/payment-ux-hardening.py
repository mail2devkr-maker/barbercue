from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one anchor in {path}, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))

# WEB — FastQue Credits selection remains a non-authoritative preview. Do not show a client-
# calculated final payable amount before the booking transaction has applied/clamped credits.
replace_once(
    'apps/web/components/booking/BookingFlow.tsx',
    '            const payable = Math.max(0, servicePrice - creditsToRedeem);\n',
    '',
)
replace_once(
    'apps/web/components/booking/BookingFlow.tsx',
    '                  {creditsToRedeem > 0\n                    ? `Applying ${formatMoney(creditsToRedeem, currency, countryCode)} — you pay ${formatMoney(payable, currency, countryCode)}`\n                    : "Slide to apply credits"}\n',
    '                  {creditsToRedeem > 0\n                    ? `Applying ${formatMoney(creditsToRedeem, currency, countryCode)} in FastQue Credits — the final payable amount is confirmed by FastQue after the booking is created.`\n                    : "Slide to apply credits"}\n',
)

# WEB — before booking creation, expose only payment availability. The QR is revealed only in the
# already-existing confirmedBooking branch, alongside authoritative booking.payableAmount.
replace_once(
    'apps/web/components/booking/BookingFlow.tsx',
    '              <>\n                <span>Shop payment QR is ready. Final amount is confirmed by the server after any FastQue Credits are applied.</span>\n                {paymentInfo.paymentQrImageUrl && <img src={paymentInfo.paymentQrImageUrl} alt="Shop UPI payment QR" width={180} height={180} style={{ maxWidth: "100%", objectFit: "contain" }} />}\n              </>\n',
    '              <span>Online UPI payment is available. FastQue will show the shop QR and the exact server-confirmed amount after your booking is created.</span>\n',
)

# MOBILE — remove the client-calculated pre-booking payable total. The selected credits are still
# visible in the stepper; authoritative payableAmount is rendered only from the booking response.
replace_once(
    'apps/mobile/screens/ConfirmBookingScreen.tsx',
    "          <Text style={styles.policyLine}>\n            {t.payableAmountLabel}: {formatMoney(Math.max(0, servicePrice - creditsToRedeem), null)}\n          </Text>\n",
    "          {creditsToRedeem > 0 && (\n            <Text style={styles.policyLine}>\n              {formatMoney(creditsToRedeem, null)} in FastQue Credits selected. The final payable amount is confirmed by FastQue after the booking is created.\n            </Text>\n          )}\n",
)

# MOBILE — same pre/post boundary as web: no QR before the booking exists. The confirmed booking
# branch keeps the QR and uses booking.payableAmount from the server response.
replace_once(
    'apps/mobile/screens/ConfirmBookingScreen.tsx',
    "          <>\n            <Text style={styles.hint}>Shop payment QR is ready. The server confirms the final amount after any FastQue Credits are applied.</Text>\n            {paymentInfo.paymentQrImageUrl && <Image source={{ uri: paymentInfo.paymentQrImageUrl }} style={styles.paymentQrSmall} resizeMode=\"contain\" />}\n          </>\n",
    "          <Text style={styles.hint}>Online UPI payment is available. FastQue will show the shop QR and the exact server-confirmed amount after your booking is created.</Text>\n",
)

# Remove the now-unused pre-confirm QR style while retaining the post-confirm paymentQr style.
replace_once(
    'apps/mobile/screens/ConfirmBookingScreen.tsx',
    "  paymentQrSmall: { width: 160, height: 160, alignSelf: 'center', marginVertical: space[2] },\n",
    '',
)

# Deterministic source guards for the safety invariant this hotfix exists to enforce.
web = read('apps/web/components/booking/BookingFlow.tsx')
mobile = read('apps/mobile/screens/ConfirmBookingScreen.tsx')

if 'width={180}' in web:
    raise RuntimeError('Web still renders the pre-confirmation QR.')
if 'const payable = Math.max(0, servicePrice - creditsToRedeem);' in web:
    raise RuntimeError('Web still calculates a pre-confirmation final payable amount.')
if 'width={220}' not in web or 'Amount payable: {formatMoney(booking.payableAmount' not in web:
    raise RuntimeError('Web post-booking authoritative QR/amount presentation was lost.')
if 'paymentQrSmall' in mobile:
    raise RuntimeError('Mobile still contains the pre-confirmation QR presentation.')
if 'formatMoney(Math.max(0, servicePrice - creditsToRedeem), null)' in mobile:
    raise RuntimeError('Mobile still calculates a pre-confirmation final payable amount.')
if 'style={styles.paymentQr}' not in mobile or 'Amount payable: {formatMoney(booking.payableAmount, null)}' not in mobile:
    raise RuntimeError('Mobile post-booking authoritative QR/amount presentation was lost.')

print('Payment UX hardening applied and source invariants verified.')
