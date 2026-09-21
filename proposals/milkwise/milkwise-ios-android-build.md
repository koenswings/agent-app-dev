# MilkWise — iOS & Android Build Guide

**Project:** MilkWise React Native App  
**Repo:** `koenswings/milkwise-rn` · Local: `varia/milkwise/`  
**Framework:** Expo SDK 54 / React Native 0.81  
**Build system:** EAS Build (Expo Application Services — cloud builds)  
**Date:** 2026-09-01 (updated)

---

## Overview

MilkWise is a React Native app built with Expo. Development and testing run locally via Expo Go. Production builds for the App Store (iOS) and Google Play (Android) are compiled in the cloud via EAS Build — **not** on the Pi, because the Pi's ARM architecture cannot run the Hermes JavaScript compiler required for store submissions.

---

## Prerequisites

### Accounts

| Service | Purpose | Cost |
|---------|---------|------|
| Expo account | EAS Build, project hosting | Free |
| Apple Developer Program | iOS App Store submission | $99/year |
| Google Play Console | Android Play Store submission | $25 one-time |

### Local tools

```bash
# Node.js (already installed)
node --version   # 22.x

# Expo CLI
npm install -g expo-cli eas-cli

# Confirm EAS login
eas whoami
```

### App identifiers (already configured in `app.json`)

| Platform | Identifier |
|----------|-----------|
| iOS | `com.koenswings.milkwise` |
| Android | (auto from slug `milkwise`) |
| Expo project ID | `16e4e7d9-35a5-4604-9046-bf630253ab73` |

---

## Development (Expo Go)

For day-to-day development, no build is needed. The app runs inside the Expo Go client on a physical device or simulator.

### 1. Configure the API URL

Create `.env.local` in `varia/milkwise/` (gitignored):

```
EXPO_PUBLIC_API_URL=http://100.85.108.118:3333
```

This points to the MilkWise web app running on idea02 (Tailscale IP). Swap for a local address if running the web app locally.

### 2. Start the Metro bundler

```bash
cd varia/milkwise
npx expo start --lan --port 8082
```

Open the QR code in Expo Go on your device (must be on the same Wi-Fi network as the Pi, or connected via Tailscale).

### 3. TypeScript check

```bash
npx tsc --noEmit
```

---

## Production Builds (EAS Build)

EAS Build runs in the cloud on Expo's infrastructure. You push your source code; Expo compiles it and returns a signed `.ipa` (iOS) or `.aab` (Android).

### EAS configuration (`eas.json`)

```json
{
  "cli": {
    "version": ">= 12.0.0",
    "appVersionSource": "local"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "store"
    },
    "production": {
      "distribution": "store",
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascApiKeyPath": "./AuthKey_HYRJUKYMTB.p8",
        "ascApiKeyId": "HYRJUKYMTB",
        "ascApiKeyIssuerId": "a0b17ef9-b9bc-4c4d-9b27-074fe6587570",
        "ascAppId": "6796410350"
      }
    }
  }
}
```

Three profiles are defined:

| Profile | Purpose | Distribution |
|---------|---------|-------------|
| `development` | Dev client with debugging | Internal (TestFlight / internal track) |
| `preview` | Near-production test build | Internal |
| `production` | Store submission build | App Store / Google Play |

---

## iOS Build

### One-time setup (✅ completed 2026-09-01)

| Step | Status | Notes |
|------|--------|-------|
| Apple Developer account | ✅ Enrolled | `koen.swings@me.com` |
| Bundle ID registered | ✅ Done | `com.koenswings.milkwise` |
| EAS credentials (distribution cert + provisioning profile) | ✅ Done | Managed by EAS |
| App Store Connect app record | ✅ Done | App ID `6796410350` |
| Apple API key (.p8) | ✅ Done | Key ID `HYRJUKYMTB`, Issuer `a0b17ef9-b9bc-4c4d-9b27-074fe6587570`, file at `varia/milkwise/AuthKey_HYRJUKYMTB.p8` |
| First preview build | ✅ Done | `.ipa` artifact produced by EAS on 2026-09-01 |
| TestFlight submission | ⏳ In progress | `eas submit --platform ios --latest` |

To re-run credentials setup (e.g. after cert expiry):

```bash
cd varia/milkwise
EXPO_TOKEN=gDC-sqF9kLgF-k4jfuPzWdQRE-AuUoyBWpFqwItQ EXPO_APPLE_ID=koen.swings@me.com eas credentials --platform ios
```

Select **"Set up all the required credentials to build your project"** → EAS manages everything automatically. Skip push notifications (not yet wired up).

### Build

```bash
cd varia/milkwise

# Preview build (for TestFlight testing)
eas build --platform ios --profile preview

# Production build (for App Store submission)
eas build --platform ios --profile production
```

EAS prints a build URL. The build runs in the cloud (10–20 minutes). When complete, download the `.ipa` or submit directly.

### Submit to App Store

```bash
eas submit --platform ios --latest
```

This submits the most recent iOS build to App Store Connect. Review in App Store Connect, fill in metadata, and submit for Apple review.

---

## Android Build

### One-time setup

1. **Google Play Console** — create an account at [play.google.com/console](https://play.google.com/console). Pay the $25 registration fee.
2. **Keystore** — EAS manages the Android signing keystore automatically. Run once:

```bash
eas credentials --platform android
```

Select "Let EAS manage credentials". The keystore is stored securely on Expo's servers.

### Build

```bash
cd varia/milkwise

# Preview build (APK — can install directly on device)
eas build --platform android --profile preview

# Production build (AAB — for Play Store)
eas build --platform android --profile production
```

The production build produces an `.aab` (Android App Bundle), which the Play Store requires.

### Submit to Google Play

```bash
eas submit --platform android --latest
```

Or manually upload the `.aab` in the Google Play Console under **Production → Create new release**.

---

## Both Platforms Simultaneously

```bash
eas build --platform all --profile production
```

---

## Version Management

The app version is defined in `app.json`:

```json
{
  "version": "1.0.0"
}
```

With `"autoIncrement": true` in the `production` profile, EAS automatically increments the build number (`versionCode` on Android, `buildNumber` on iOS) with each production build. The user-facing version string (`1.0.0`) must be bumped manually in `app.json` before a new release.

---

## Shared Core — Sync Rule

Two files are shared between `milkwise-rn` and `baby-milk-tracker` (the web app). Any change to either must be applied to **both repos in the same session**:

| File | Purpose |
|------|---------|
| `src/types/index.ts` | Shared type definitions |
| `src/lib/calculations.ts` | Business logic (smoothed formula, stats, predictors) |

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `EXPO_PUBLIC_API_URL` | `.env.local` (gitignored) | Web app API base URL |

For production builds, the API URL should point to the production MilkWise instance (idea02 or future hosting). Update `.env.local` or set via EAS environment variables before building.

---

## Known Limitations

| Issue | Status |
|-------|--------|
| Push notifications | Skipped during credentials setup — not yet wired up; remove capability from `app.json` before App Store submission or wire up APNs |
| ARM (Pi) cannot build locally | Use EAS cloud builds for any store submission |
| Expo Go requires SDK 54-compatible version | Install from App Store / Play Store |
| Home screen widget | Planned for v1.1 |
| Supabase household sync | Designed, not implemented (v1.1) |

---

## Quick Reference

```bash
# Login via token (preferred on Pi — avoids interactive prompts)
EXPO_TOKEN=<token> eas whoami

# Check current project
EXPO_TOKEN=<token> eas project:info

# iOS preview
EXPO_TOKEN=<token> eas build --platform ios --profile preview

# Android preview
EXPO_TOKEN=<token> eas build --platform android --profile preview

# Both production
EXPO_TOKEN=<token> eas build --platform all --profile production

# Submit iOS (uses .p8 key configured in eas.json submit block)
EXPO_TOKEN=<token> eas submit --platform ios --latest

# Submit Android
EXPO_TOKEN=<token> eas submit --platform android --latest
```
