# Guncelium Testing Guide

This document describes the **test order**, the **test sections**, and which tests **provide setup/inputs** for later tests.

The test runner in this repo is the in-app Moniker harness. The order is determined by the `tests=[...]` array in the Moniker panel.

## Principles

- **Order matters.** Some tests produce values (like onion hostnames) that later tests depend on.
- **No fallback knowing.** If a required prerequisite is missing, the test should fail fast.
- **Bounded waits only.** All waits/retries must be finite and verifiable.

## Where the Order Is Defined

- [src/init/panels/MonikerPanel.js](src/init/panels/MonikerPanel.js)

That file lists tests in the intended run order.

## Section 1: Tor

### 1.1 Tor Setup + Self Tests

Goal: Prove Tor is installable/bootable and that each platform can host or use Tor locally.

Order and purpose:

1) **TorGunHosting (Electron only)**
- File: [src/__e2e_tests__/torGunHosting.js](src/__e2e_tests__/torGunHosting.js)
- Runs only in Electron renderer.
- Verifies:
  - Electron Gun service works (HTTP/WS sync sanity)
  - Electron Gun TCP can be hosted
  - Tor hidden service can be created with a fresh random onion identity

2) **RnTorSmoke (Android/React Native only)**
- File: [src/__e2e_tests__/rnTorSmoke.js](src/__e2e_tests__/rnTorSmoke.js)
- Runs only in React Native.
- Verifies:
  - RN Tor service is present and `tor.status()` returns sane values

3) **RnTorHosting (Android/React Native only)**
- File: [src/__e2e_tests__/rnTorHosting.js](src/__e2e_tests__/rnTorHosting.js)
- Runs only in React Native.
- Verifies:
  - RN can host a local TCP server
  - RN can configure a Tor hidden service with a fresh random onion
  - RN can fetch that onion over Tor SOCKS

What this subsection provides:
- Confidence that Tor is installed and can boot.
- A baseline expectation for Tor startup time on the device.

### 1.2 Tor Cross-Device Tests (Electron ↔ Android)

Goal: Prove two devices can exchange Gun data over Tor.

There are two tests that cooperate:

1) **TorGunExchangeHost (Electron only)**
- File: [src/__e2e_tests__/torGunExchangeHost.js](src/__e2e_tests__/torGunExchangeHost.js)
- Runs only in Electron renderer.
- Responsibilities:
  - Start Gun TCP in Electron main
  - Create a fresh hidden service (random onion) mapping onion port `8888` → local Gun TCP port
  - Emit a deep link line:
    - `[duo] ANDROID_LAUNCH_URL=...`

2) **TorGunExchangeClient (Android/React Native only)**
- File: [src/__e2e_tests__/torGunExchangeClient.js](src/__e2e_tests__/torGunExchangeClient.js)
- Runs only in React Native.
- Responsibilities:
  - Read the deep link from `Linking.getInitialURL()`
  - Start Tor and wait until `tor.status().running === true`
  - Start Gun TCP client configured to connect to `tcp://<onion>.onion:8888` via Tor SOCKS
  - Write a `ping` value; wait for the `pong` response

What this subsection provides:
- A single, end-to-end signal that cross-device Tor + framed TCP + Gun are working.

## Duo Runner Integration (Electron-first)

- Script: [scripts/duo-electron-android.js](scripts/duo-electron-android.js)

What it does:

1) Starts Electron via `npm run electron:start` (which also starts Metro)
2) Runs `adb reverse` for required ports (default `8081`)
3) Stops/kills the Android app
4) Waits for Electron to print `[duo] ANDROID_LAUNCH_URL=...`
5) Launches Android via deep link (`adb shell am start ... -d <url>`)
6) Exits after two Moniker completions are observed

## Why Android “times out trying to use Tor”

Common causes we’ve seen during runs:

- Tor on Android sometimes needs more time to bootstrap (especially on first run, or if the device is resource constrained).
- Starting network clients before `tor.status().running === true` leads to early SOCKS handshake failures.

Mitigations in current tests:

- Cross-device client waits for `tor.status()` to report running before attempting Gun-over-Tor.
- Cross-device host allows a longer bounded wait for the Android ping.

## Optional: Coordination Server (future)

You suggested a coordination server (e.g. Socket.IO) to exchange parameters (onion host/run ids) before tests start.

Current approach (already implemented) avoids a third party:
- The host prints `[duo] ANDROID_LAUNCH_URL=...`.
- The duo runner uses that line to start Android with the correct parameters.

If we do add a coordination server later, it should be:
- Strictly optional for local/dev, and
- Bounded (timeouts, max connections), and
- Not required for correctness of the Tor transport itself.
