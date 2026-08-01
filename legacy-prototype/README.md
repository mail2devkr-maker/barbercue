> **Archived prototype.** This folder is the original single-screen-set Expo prototype, preserved
> as-is for reference and recoverability. Active development has moved to the `apps/`
> monorepo at the repo root — see the root `README.md` and `ARCHITECTURE.md`. This folder is
> self-contained (its own `package.json`/`package-lock.json`) and can still be run standalone by
> `cd`-ing into it and following the steps below; it is not part of the new build.

# BarberCue — barbershop queue & booking app

A starter app that lets customers see which nearby barbershops are free, short-wait, or fully
booked, and book an open time slot — plus a shop-owner dashboard to update chair status and see
today's bookings. Built with React Native + Expo so one codebase targets both iOS and Android.

**This is a working prototype with mock data**, not a finished product. Before real customers can
use it, you need a backend (see "What's missing" below).

## 1. Run it on your phone (5 minutes, no Mac needed)

1. Install [Node.js](https://nodejs.org) (LTS version) on your computer.
2. Open a terminal in this folder and run:
   ```
   npm install
   npx expo start
   ```
3. Install the free **Expo Go** app on your iPhone or Android phone (App Store / Play Store).
4. Scan the QR code shown in your terminal with Expo Go (Android: scan directly in the app;
   iPhone: scan with the Camera app, it'll offer to open in Expo Go).
5. The app loads on your phone. Try both "I'm a customer" and "I run a shop" from the home screen.

## 2. Build a standalone .apk to hand out directly (no Play Store)

This produces one .apk file you can send to a barbershop by email, WhatsApp, USB, whatever — they
install it directly on their Android phone/tablet, no Play Store account needed.

1. Create a free [Expo account](https://expo.dev/signup) (only needed to use the free cloud build
   service — it doesn't publish anything publicly).
2. In this folder, run:
   ```
   npm install -g eas-cli
   eas login
   eas build --platform android --profile preview
   ```
3. This uploads the project to Expo's servers, builds it, and after 10-20 minutes gives you a
   download link (also viewable at https://expo.dev under your account's Builds tab).
4. Download the `.apk` file and send it to the barbershop.
5. On their Android device: open the file. Android will show a warning like "Install unknown apps
   blocked" the first time — they'll need to tap **Settings** in that prompt and allow installs
   from whatever app they used to open the file (e.g. Files, WhatsApp, Gmail). This is normal for
   any app installed outside the Play Store, not a sign anything's wrong.
6. Once installed, it behaves like any other app — icon on the home screen, opens normally.

Note: this only works for Android. Apple doesn't allow installing iOS apps outside the App Store
(or Apple's TestFlight beta system) at all, so there's no iPhone equivalent of "send them a file."

## 3. Get it onto the App Store and Play Store

Expo's **EAS Build** service compiles real, installable iOS and Android apps in the cloud — you
don't need a Mac, even for iOS.

1. Create a free [Expo account](https://expo.dev/signup).
2. `npm install -g eas-cli`
3. `eas login`
4. `eas build:configure`
5. Build for both platforms: `eas build --platform all`
   (this produces a `.aab` for Android and a `.ipa` for iOS)
6. Submit to the stores: `eas submit --platform android` and `eas submit --platform ios`

You'll separately need:
- An **Apple Developer account** ($99/year) — required to publish on the App Store, and to run
  `eas submit --platform ios`.
- A **Google Play Console account** ($25 one-time) — required to publish on Google Play.
- App Store assets: app icon, screenshots, a short description, and a privacy policy URL (Apple
  requires this even for simple apps).

Full walkthrough: https://docs.expo.dev/deploy/submit-to-app-stores/

## 4. What's missing before this can go live

This prototype uses fake data (`data/mockData.js`) and doesn't save anything. For a real launch
you'd need:

- **A backend** to store shops, chairs, bookings, and users — e.g. Firebase, Supabase, or a custom
  API. This is the biggest piece of remaining work.
- **Real-time chair status** — so a barber marking themselves "busy" instantly updates what
  customers see (Firebase/Supabase both support this out of the box).
- **Accounts** for customers (to manage their bookings) and shop owners (to manage their shop).
- **Notifications** — reminding customers when their slot is coming up.
- **Shop onboarding** — a way for barbershops to sign up, list their chairs, and set hours.
- **Payments**, if you want to charge a booking fee or take deposits (Stripe is the common choice).

## Project structure

```
App.js                        # Navigation setup
screens/
  RoleSelectScreen.js          # Home — choose customer or shop-owner
  ShopListScreen.js            # Customer: browse nearby shops
  ShopDetailScreen.js          # Customer: pick an open time slot
  BookingConfirmScreen.js      # Customer: booking confirmation
  OwnerDashboardScreen.js      # Owner: chair status + today's bookings
data/mockData.js               # Placeholder data — swap for real API calls
```
