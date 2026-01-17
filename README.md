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

## Notes / Constraints

This codebase follows a strict “fail-fast” philosophy:

- No silent fallbacks
- Parameter validation at boundaries
- Errors are surfaced loudly (crash/throw rather than continuing invisibly)
