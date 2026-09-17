# Optional online payment booking contract

Production behavior required by FastQue:

- A shop may accept APP/WEB bookings without configuring a UPI/payment QR.
- Missing online-payment setup must never disable or reject booking confirmation.
- Such a booking is confirmed normally and the customer pays at the shop.
- PARTIAL/FULL prepayment applies only when online payment has actually been configured.
- A configured shop QR may be shown after booking; absence of a QR is not an error state.
