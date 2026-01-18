# Guncelium

**Status: ALPHA.** This project is under active development and is **not ready for production applications** yet.

**Platform note:** iOS is not supported yet because the lead developer does not currently have a Mac for development/testing.

Guncelium is an **earth-based, local-first** networking stack for building apps that keep working when centralized infrastructure (the “cloud”) disappears.

It combines:

- **Tor** for anonymous discovery/signaling and censorship-resistant reachability
- **Gun.eco** as the CRDT/graph layer for eventual consistency
- A transport layer that can move data over multiple “wires” (starting with a custom framed TCP transport)

The long-term goal is a resilient “digital root system”: data lives in the user’s own hardware, and devices can synchronize opportunistically (online or offline) across multiple mediums.

## Project goals (why this repo exists)

This project is meant to tie together multiple experiments into one coherent system, with two major goals:

1) **Connectivity**: a consistent networking story across three environments.
2) **Serviceability**: one codebase that can run as a background service, a desktop app, and a mobile app.

### Mental model

Think of Guncelium as a **multi-transport Gun network**:

- **Gun is the shared graph** and sync logic.
- **Transports are adapters**:
	- **HTTP/WS** for browsers and “web-style” peers.
	- **Framed TCP** for direct sockets and Tor onion services.
	- **Tor** provides stable reachability (hidden services) and `.onion` dial-out via SOCKS5.
	- **WebRTC** is a future transport for lower-latency browser↔browser links.

The core objective is that every environment participates in the *same* network, even if each environment uses different transports to do it.

### Connectivity: 3 target environments

- **Node.js (headless / background node)**
	- Role: a always-on “service node” that can run without UI.
	- Provides an **HTTP/WS Gun endpoint** so browsers (and other web-style peers) can join the network.
	- Also participates in the **Tor onion mesh** and can host/connect to framed TCP peers.
	- Future direction: add **WebRTC** so browsers can mesh faster when available, while still having Tor/TCP as the resilient baseline.

- **Electron (desktop)**
	- Electron has three layers: **main** / **preload** / **renderer**.
	- **Main = service host**
		- Owns the long-lived service instances: Tor process + hidden services, Gun instance(s), and framed TCP listeners.
		- Exposes both “service-node style” interfaces:
			- HTTP/WS for browser-style Gun peers.
			- framed TCP for Tor hidden-service hosting and direct TCP peers.
	- **Preload = capability bridge**
		- Exposes a controlled API to the renderer (e.g. `window.ElectronNative.*`) so the UI can start/stop/query Tor and Gun without giving the renderer full Node privileges.
	- **Renderer = UI + browser peer**
		- Displays status and control panels.
		- Runs a browser-style Gun client that connects to the HTTP/WS endpoint hosted by **main**.
		- This keeps desktop behavior consistent with the Node.js “background node” model: main provides services; renderer consumes them like a browser would.

- **React Native (mobile)**
	- Role: a mobile peer that should be able to host and join the mesh with minimal infrastructure.
	- Focuses on **framed TCP** + Tor connectivity:
		- Dial `.onion` peers via Tor SOCKS5.
		- Host a framed TCP listener and publish it via a Tor v3 hidden service.
	- Future direction: expand toward **WebRTC** where feasible, but keep the TCP/Tor path as the deterministic baseline.

### Serviceability: one codebase

Using Expo plus `expo-electron` is a key design choice: it bridges “service mode”, desktop, and mobile while sharing as much code and behavior as possible.

Practically, this means:

- Shared UI and runtime composition (Expo app) across desktop and mobile.
- Shared module APIs in `modules/`, with environment-specific entrypoints (Node/Electron/RN) selected by the bundler/runtime.
- Electron main behaves like a local “service node” so the renderer can stay closer to a browser-like environment.

### Decentralized escrow bots (planned)

Guncelium is also intended to grow into a network that can support **decentralized escrow/governance bots**.

The goal is to enable **3rd-party AI services** to operate on the network and get paid for their work in a way that:

- Doesn’t require trusting a single server/operator.
- Preserves participant privacy (Tor).
- Uses the shared Gun graph for coordination/state.

These are currently **proposal/draft docs** (not implemented yet), but they represent a major direction for the project:

- Decentralized autonomous bot governance over Tor + Gun: [docs/white-paper-decentralized-bot.md](docs/white-paper-decentralized-bot.md)
- Decentralized data escrow for private AI computation + settlement: [docs/white-paper-decentralized-escro.md](docs/white-paper-decentralized-escro.md)

## Architecture (high-level)

- **Control Plane**: Tor (onion identities, hidden services, NAT traversal via onion routing)
- **Graph Layer**: Gun (conflict-free merging and replication)
- **Wire Layer**: transport-agnostic links (TCP framing today; WebRTC/BLE/Wi‑Fi P2P envisioned)

For deeper design context:

- Vision/manifest: [docs/guncelium-idea.md](docs/guncelium-idea.md)
- Onion-mesh proposal: [docs/onion-mesh.md](docs/onion-mesh.md)

## What’s in this repo

- **Rectify plugin assembly** lives in `src/` (services are composed and provided to the UI/runtime).
- **Stable module APIs + environment selection** live in `modules/`.

Key modules:

- `modules/guncelium-tor`: Tor install/start/stop + hidden service tooling (Electron main; RN support in progress)
- `modules/guncelium-gun`: Gun service (Electron main)
- `modules/guncelium-protocal`: framed TCP transport with optional Tor SOCKS5 dial-out for `.onion` peers

## Running

Install deps:

```sh
npm install
```

### Electron

```sh
npm run electron:start
```

### Expo (mobile/web)

```sh
npm start
```

## Testing

There isn’t a Jest-style test runner wired up yet. The primary verification path right now is an **in-app E2E harness** (Test Moniker) plus a **Node CLI smoke test**.

### Expo / React Native (CLI + smoke checks)

Run the app on devices/simulators:

- Metro + Dev Client: `npm start`
- Android (dev build): `npm run android`
- iOS (dev build): `npm run ios`
- Web (Expo web): `npm run web`

Sanity-check the Expo project:

- `npx expo-doctor` (runs diagnostics for the project)
- `npx expo config --type public` (prints the resolved Expo config)
- `npx expo --version`

Native regeneration (CNG/prebuild):

- `npx expo prebuild` (regenerates `android/` + `ios/` from Expo config)

Notes:

- The current in-app E2E test (below) is **Electron-renderer only** and will fail on Expo because it requires the Electron preload bridge (`window.ElectronNative`).
- React Native Tor hosting + Gun-over-TCP hosting tests are not wired up yet (work in progress).

### E2E (Electron UI / Test Moniker)

This runs inside the Electron renderer and uses the real Tor + Gun services.

- Start Electron: `npm run electron:start`
- In the app UI, open the **Test Moniker** panel
- Run: **“Tor: host Gun TCP as hidden service”**

What it does (high level):

- Starts Gun TCP on `127.0.0.1` with a random port
- Ensures Tor is installed (installs if missing)
- Creates a v3 hidden service mapping `virtualPort: 8888` → the Gun TCP port
- Starts Tor (non-destructive: `cleanSlate: false`)
- Waits (bounded) for an onion hostname and prints `<hostname>.onion`
- Stops Tor and Gun at the end (or on failure)

Test definition: [src/__e2e_tests__/torGunHosting.js](src/__e2e_tests__/torGunHosting.js)

### CLI smoke test (Node)

The repo ships a small CLI (useful for headless/manual testing):

- Help: `npm run guncelium -- help`
- Install Tor into the data dir: `npm run guncelium -- tor-install`
- Show Tor info: `npm run guncelium -- tor-info`
- Start Gun TCP (+ optional Tor HS) until Ctrl+C:
	- Without Tor: `npm run guncelium -- service`
	- With Tor HS: `npm run guncelium -- service --tor`

Notes:

- CLI output is JSON lines (easy to pipe/parse).
- The CLI uses a per-user state directory by default (`$XDG_STATE_HOME/guncelium` or `~/.local/state/guncelium`). Override with `--data-dir PATH`.

## Current wiring

In Electron:

- Gun can run in a classic HTTP/WS mode (for browser-style peers).
- Gun can also run in a **TCP mesh mode** using `guncelium-protocal` (framed messages) so it can be hosted behind a Tor **hidden service**.

Persistence (today):

- Electron/Node Gun uses Gun’s built-in disk store via `file: <userData>/gun/radata`.

The UI includes setup panels to start/stop Tor, create hidden services, and start/stop Gun.

## Planned wiring

These are the next topology/persistence goals (not all are implemented yet):

- **SQLite as the default Gun store** across Electron + React Native, with deterministic default file locations (see “Persistence (Gun store)” below).
- **React Native / Expo**: host Gun over the framed TCP protocol and expose it via a Tor v3 hidden service (static/random/vanity onions).
- **Node service mode**: participate in the Tor/TCP mesh and also expose an HTTP/WS gateway for browser-style peers.

## Networking (Node.js + React Native ports)

If you’re maintaining a Gun port (or a custom runtime) and want to join the Guncelium TCP mesh, start here:

- Protocol + design notes: [docs/networking-nodejs-and-react-native.md](docs/networking-nodejs-and-react-native.md)
- Canonical implementation (what the app actually uses): [modules/guncelium-protocal/socketAdapter.js](modules/guncelium-protocal/socketAdapter.js)

At a high level:

- Transport is a **framed TCP stream**: a fixed 5-byte header (`u32be length` + `u8 type`) followed by `length` bytes payload.
- Peers are addressed as `tcp://host:port` (direct) or via Tor as `<56chars>.onion` + a virtual port.
- On `.onion` dial-out, the connector speaks **SOCKS5** to the local Tor SOCKS port (typically `127.0.0.1:9050`) before switching to framed application traffic.
- The adapter exposes a WebSocket-like surface (`onopen`, `onmessage`, `onclose`, `send`) so Gun mesh can treat TCP like a “wire”.

Porting checklist:

- Provide a socket implementation with deterministic lifecycle (connect, data events, close) equivalent to Node’s `net.Socket` / RN TCP sockets.
- Enforce hard bounds (max frame size, bounded waits/retries) and fail-fast on malformed frames or failed SOCKS5 handshakes.

## Crypto (what we use and why)

Guncelium has two distinct cryptographic domains:

1) **Gun SEA (application-layer crypto)** for encrypting/signing user data inside the Gun graph.
2) **Tor v3 onion identities (network-layer crypto)** for stable service addresses and reachability.

These are intentionally separate: Tor onions are *transport identity*; Gun SEA is *data identity/crypto*.

### Gun SEA and `native-sea` (React Native)

Gun’s built-in SEA module provides:

- Keypairs for Gun identities
- Signing/verifying messages
- Encrypting/decrypting payloads

On React Native, we install `native-sea` to provide a faster native-backed implementation of SEA primitives.

- **Where it’s wired**: `modules/guncelium-gun/react-native/index.js` installs `native-sea` into Gun at startup.
- **Back-end**: `native-sea-openssl` provides the native implementation.

Important notes:

- `native-sea` is **RN/Expo-only**. Attempting to use it in plain Node will fail (by design).
- `native-sea` is used for **Gun SEA** crypto (secp256r1 / P-256 style primitives). It is *not* used for Tor onion keys.

### Tor hidden services and onion v3 keys

Tor v3 onion addresses are derived from an **ed25519** public key (plus checksum + version). Guncelium supports two ways of providing HS keys:

- **Static onion** (deterministic): provide a 32-byte ed25519 seed and (optionally) a public key.
- **Generated onion** (random), optionally with a **vanity prefix** such as `gun`.

The shared “key spec” shape is:

- Static: `{ generate: false, onion, seed_hex, pub_hex }`
- Random: `{ generate: true }`
- Vanity: `{ generate: true, vanity: 'gun', maxAttempts: 250000 }`

The `maxAttempts` loop is always bounded, and vanity generation throws if it can’t find a match in the bound.

### Onion generation: Node/Electron-main (fast path)

In Node/Electron main we use Node’s built-in crypto:

- `crypto.generateKeyPairSync('ed25519')` to generate keypairs
- `js-sha3` for checksum derivation (to avoid OpenSSL/Node differences)

Implementation details:

- The core implementation is in `modules/guncelium-tor/main/service/onionCrypto.js`.
- Hidden-service key material is written in Tor’s expected format in `modules/guncelium-tor/main/service/hiddenServices.js`.

### Onion generation: React Native / Expo (on-device)

React Native doesn’t have Node’s `crypto.generateKeyPairSync`, so the on-device implementation uses:

- `expo-crypto.getRandomValues(typedArray)` for secure randomness
- `tweetnacl` to derive an ed25519 keypair from a 32-byte seed
- `js-sha3` to compute the Tor v3 checksum

Implementation details:

- RN entrypoint: `modules/guncelium-tor/onion/index.native.js`
- This path is **fail-fast**: if `expo-crypto.getRandomValues` is unavailable, onion generation throws immediately.

### How vanity keys are applied to Tor (RN)

The RN Tor wrapper accepts `opts.keys` mirroring the old `rn_tor_app` style. If a key entry is `{ generate: true, vanity: 'gun' }`, Guncelium converts it into a static `{ seed_hex, pub_hex, onion, generate: false }` key entry before passing it to `react-native-nitro-tor`.

- Where: `modules/guncelium-tor/react-native/index.js`

This keeps the Tor bridge’s behavior deterministic and makes vanity generation explicit and bounded.

## Notes / Constraints

This codebase follows a strict “fail-fast” philosophy:

- No silent fallbacks
- Parameter validation at boundaries
- Errors are surfaced loudly (crash/throw rather than continuing invisibly)

## Persistence (Gun store)

**Goal:** SQLite-backed persistence should be the default Gun store across environments (Electron + React Native), so data can be reliably persisted and migrated.

**Default SQLite file locations (planned):**

- **Electron**: inside the app user-data directory (`app.getPath('userData')`), e.g. `<userData>/gun/guncelium.sqlite`.
- **React Native / Expo**: inside the app document data directory, e.g. `FileSystem.documentDirectory + 'gun/guncelium.sqlite'`.
- **Node (CLI / service)**: inside the project root (current working directory), e.g. `./gun/guncelium.sqlite`.

These defaults are meant to be deterministic and local-first. Overrides should remain explicit (pass a path in options/flags) and errors should be fail-fast.

**Current behavior (today):**

- **Electron / Node**: Gun is started with `file: <userData>/gun/radata` (Gun’s built-in disk store). This is configured in [modules/guncelium-gun/main/index.js](modules/guncelium-gun/main/index.js).
- **React Native / Expo**: the Gun wiring is focused on crypto (`native-sea`) and transport; a SQLite store is not yet wired as the default.

**Planned behavior:**

- Replace/override Gun persistence with a **SQLite-backed key/value store**.
- Use a shared schema so Electron and RN can interoperate on the same logical storage model (RN likely via `expo-sqlite`; Node likely via a SQLite driver).

This section describes intended direction; it does not imply SQLite persistence is already the default.
