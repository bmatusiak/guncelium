# Guncelium

Guncelium is an **earth-based, local-first** networking stack for building apps that keep working when centralized infrastructure (the “cloud”) disappears.

It combines:

- **Tor** for anonymous discovery/signaling and censorship-resistant reachability
- **Gun.eco** as the CRDT/graph layer for eventual consistency
- A transport layer that can move data over multiple “wires” (starting with a custom framed TCP transport)

The long-term goal is a resilient “digital root system”: data lives in the user’s own hardware, and devices can synchronize opportunistically (online or offline) across multiple mediums.

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
npm run electron
```

### Expo (mobile/web)

```sh
npm start
```

## Current wiring

In Electron:

- Gun can run in a classic HTTP/WS mode (for browser-style peers).
- Gun can also run in a **TCP mesh mode** using `guncelium-protocal` (framed messages) so it can be hosted behind a Tor **hidden service**.

The UI includes setup panels to start/stop Tor, create hidden services, and start/stop Gun.

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
