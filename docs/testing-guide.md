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

1) **RnTorSmoke (Android/React Native only)**
- File: [src/__e2e_tests__/rnTorSmoke.js](src/__e2e_tests__/rnTorSmoke.js)
- Runs only in React Native.
- Verifies:
  - RN Tor service is present and `tor.status()` returns sane values

2) **RnTorHosting (Android/React Native only)**
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

Goal: Prove two devices can connect and exchange a small framed message over Tor (no Gun).

There are two tests that cooperate:

1) **TorProtoExchangeHost (Electron only)**
- File: [src/__e2e_tests__/torProtoExchangeHost.js](src/__e2e_tests__/torProtoExchangeHost.js)
- Runs only in Electron renderer.
- Responsibilities:
  - Start a local framed protocol server (TCP)
  - Create a fresh hidden service (random onion) mapping onion port `8888` → local protocol TCP port
  - Publish exchange parameters to the Duo coordinator via Socket.IO (e.g. onion hostname and port)

2) **TorProtoExchangeClient (Android/React Native only)**
- File: [src/__e2e_tests__/torProtoExchangeClient.js](src/__e2e_tests__/torProtoExchangeClient.js)
- Runs only in React Native.
- Responsibilities:
  - Use the deep link only as the signal that the run is in “duo mode” (the deep link is fixed)
  - Connect to the Duo coordinator and receive exchange parameters via Socket.IO
  - Start Tor and wait until `tor.status().running === true`
  - Dial `tcp://<onion>.onion:8888` via Tor SOCKS using `guncelium-protocal`
  - Send a framed `ping`; wait for framed `pong`

What this subsection provides:
- A single, end-to-end signal that cross-device Tor + SOCKS + framed protocol are working.

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

- Cross-device client waits for `tor.status()` to report running before attempting any SOCKS dial.
- Cross-device host allows a longer bounded wait for the Android ping.

Additional note:

- The Duo coordinator eliminates several race conditions (e.g., Android starting its Tor/Gun dial before Electron finished creating the hidden service), but Tor itself can still be slow to bootstrap.

## Section 2: Gun

Goal: Test **Gun functionality** separately from Tor connectivity, so failures are attributable.

### 2.0 Gun (Local-first sanity)

These are the current default “local-first” Gun health checks:

- Electron: [src/__e2e_tests__/gunLocalElectron.js](src/__e2e_tests__/gunLocalElectron.js)
- React Native: [src/__e2e_tests__/gunLocalReactNative.js](src/__e2e_tests__/gunLocalReactNative.js)

They verify basic `put` + `once` behavior in each environment without involving Tor.

### 2.1 Gun (Electron local HTTP/WS)

- File: [src/__e2e_tests__/torGunHosting.js](src/__e2e_tests__/torGunHosting.js)
- Runs in Electron renderer.
- What it verifies (high-level):
  - Electron Gun service can start an HTTP/WS peer endpoint.
  - Two renderer Gun clients can connect and replicate a small value.

Note: This test is currently **not** in the default Moniker run order (the Tor section is intentionally protocol-only). To run it, add it back into the list in [src/init/panels/MonikerPanel.js](src/init/panels/MonikerPanel.js).

### 2.2 Gun (Cross-device over Tor) — experimental

- Files:
  - [src/__e2e_tests__/torGunExchangeHost.js](src/__e2e_tests__/torGunExchangeHost.js)
  - [src/__e2e_tests__/torGunExchangeClient.js](src/__e2e_tests__/torGunExchangeClient.js)

These are end-to-end integration tests for **Gun replication over the framed TCP transport over Tor**.

They are intentionally documented separately from Section 1 because:

- Tor bootstrap + SOCKS dial readiness is one failure domain.
- Gun replication behavior is a different failure domain.

If you enable these tests, keep [src/__e2e_tests__/duoAlign.js](src/__e2e_tests__/duoAlign.js) first so coordinator alignment stays deterministic.

## Current Development Note

Tor tests may be temporarily commented out in the default Moniker run order while stabilizing the local-first Gun layer.
Check the current test list in [src/init/panels/MonikerPanel.js](src/init/panels/MonikerPanel.js).
