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

## Section 0: Duo Alignment (Socket.IO)

Goal: Prove **both apps are running** and can **exchange data deterministically** before starting Tor-related tests.

Why this exists:

- Tor bootstrap can be variable on Android.
- Cross-device tests are much easier to reason about if we first confirm both sides are alive and able to coordinate.

### 0.1 DuoAlign (Electron ↔ Android)

- File: [src/__e2e_tests__/duoAlign.js](src/__e2e_tests__/duoAlign.js)
- Runs in both Electron renderer and React Native.
- Uses the Duo coordinator (Socket.IO) started by the duo runner:
  - Coordinator URL: `http://127.0.0.1:45820`
  - Android reaches it via `adb reverse` (see duo runner steps below)

What it verifies (in order):

1) Both sides connect to the coordinator and `register` with a `role` (`electron` or `android`).
2) Both sides observe `peerConnected` (meaning both roles are present).
3) Both sides signal `duoAligned` and wait for the coordinator’s `duoAligned` broadcast.
4) **Data swap with validation**: each side sends a small `duoData` payload and waits until the coordinator broadcasts **both** payloads back.
   - Each side validates it got its own echoed payload and the peer’s payload.

Why the data swap matters:

- It proves the coordinator channel is **bidirectional** and not just “connected”.
- It removes “blind timeouts” where one side starts a test before the other side is ready.

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
  - Publish exchange parameters to the Duo coordinator via Socket.IO (e.g. onion hostname and port)

2) **TorGunExchangeClient (Android/React Native only)**
- File: [src/__e2e_tests__/torGunExchangeClient.js](src/__e2e_tests__/torGunExchangeClient.js)
- Runs only in React Native.
- Responsibilities:
  - Use the deep link only as the signal that the run is in “duo mode” (the deep link is fixed)
  - Connect to the Duo coordinator and receive exchange parameters via Socket.IO
  - Start Tor and wait until `tor.status().running === true`
  - Start Gun TCP client configured to connect to `tcp://<onion>.onion:8888` via Tor SOCKS
  - Write a `ping` value; wait for the `pong` response

What this subsection provides:
- A single, end-to-end signal that cross-device Tor + framed TCP + Gun are working.

## Duo Runner Integration (Electron-first)

- Script: [scripts/duo-electron-android.js](scripts/duo-electron-android.js)

What it does:

1) Starts Electron via `npm run electron:start` (which also starts Metro)
2) Starts a local Duo coordinator server (Socket.IO) on `127.0.0.1:45820`
3) Runs `adb reverse` for required ports (defaults: `8081` and `45820`)
3) Stops/kills the Android app
4) Launches Android via a fixed deep link (`guncelium://e2e/duo/v1`)
5) Exits after two Moniker completions are observed

Coordinator behavior (high-level):

- Tracks which roles are connected (`electron` and `android`).
- Broadcasts `peerConnected` once both roles are present.
- Implements barriers/events used by tests:
  - `duoAligned` (both roles confirm they are ready)
  - `duoData` (both roles send a small payload; coordinator broadcasts both back)
  - `exchangeParams` (Electron host sends onion details; Android client receives them)

## Why Android “times out trying to use Tor”

Common causes we’ve seen during runs:

- Tor on Android sometimes needs more time to bootstrap (especially on first run, or if the device is resource constrained).
- Starting network clients before `tor.status().running === true` leads to early SOCKS handshake failures.

Mitigations in current tests:

- Cross-device client waits for `tor.status()` to report running before attempting Gun-over-Tor.
- Cross-device host allows a longer bounded wait for the Android ping.

Additional note:

- The Duo coordinator eliminates several race conditions (e.g., Android starting its Tor/Gun dial before Electron finished creating the hidden service), but Tor itself can still be slow to bootstrap.

## Current Development Note

Tor tests may be temporarily commented out while stabilizing the Duo alignment layer.
Check the current test list in [src/init/panels/MonikerPanel.js](src/init/panels/MonikerPanel.js).
