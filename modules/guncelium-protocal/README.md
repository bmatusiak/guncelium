# guncelium-protocal

Cross-platform transport used by Gun to speak TCP **directly** or **over Tor via SOCKS5**, with a small framing layer so Gun can run consistently across Node/Electron and React Native.

The key behavior:

- Outgoing connections to an **onion hostname** use **SOCKS5** (Tor)
- Outgoing connections to a **non-onion host** use **direct TCP** (no SOCKS)

This makes it possible to:

- Host a Gun TCP service locally and publish it as a Tor hidden service
- Connect peer-to-peer to either:
  - `*.onion` peers (via Tor)
  - normal `host:port` peers (direct)

## What this module is (and is not)

- This module provides a socket adapter (`createSocketAdapterOrThrow`) and a SOCKS5 HTTP probe (`socks5HttpGetOrThrow`).
- This module does **not** start Tor or create hidden services; that is handled by `guncelium-tor`.

## Default ports

These are the recommended defaults used across this repo and are intended to be “sane defaults” for Gun:

- Gun TCP (this framed protocol): `9876`
- Gun HTTP/WS: `8765`

## Framing protocol

Each frame is:

- 4-byte big-endian payload length
- 1-byte type
- payload bytes

Types:

- `1` = BINARY (`Uint8Array` payload)
- `2` = HEARTBEAT (empty payload)
- `3` = MESSAGE (JSON payload)

### Optional HELLO handshake (double-connect avoidance)

When `enableHello: true` is set in `createSocketAdapterOrThrow`, the adapter performs a small pre-data handshake:

- Each side sends `{ "__guncelium": "hello", "peerId": "..." }` as a MESSAGE frame.
- No application (Gun) messages are delivered until HELLO completes.
- A deterministic tie-break closes one of the two simultaneous cross-dial connections.

This is enabled by the Gun TCP transports in this repo so only one wire survives when two peers dial each other at the same time.

Design notes:

- **Recommended `peerId`:** use the peer's *currently hosted random onion hostname* (v3 host, without the `.onion` suffix). This makes the ID both globally unique and useful for skipping self-dials.
- **Tie-break rule (deterministic):** if both peers cross-dial at once, the connection whose *initiator* peerId is lexicographically greatest survives; the other side closes with `code: 'GUNCELIUM_DOUBLE_CONNECT'`.
- **Fail-fast:** if `peerId` matches the remote `peerId`, the adapter closes with `code: 'GUNCELIUM_SELF_CONNECT'`.

## Onion detection rules

The socket adapter treats a destination as an onion service when the host matches:

- Tor v3: 56 base32 chars (`a-z2-7`) with or without the `.onion` suffix
- Tor v2 (legacy): 16 base32 chars with or without the `.onion` suffix

When an onion host is detected, the adapter connects to `socksHost:socksPort` and performs a SOCKS5 CONNECT to `<onion>.onion:<port>`.

## Canonical peer URL format

Use a single canonical peer URL string everywhere (Gun mesh, config, UI):

`tcp://<host>:<port>`

Where:

- `<port>` is `1..65535`
- `<host>` is either:
  - a normal host/IP (direct TCP), e.g. `127.0.0.1`, `example.com`
  - an onion hostname (SOCKS/Tor), either of:
    - v3 host without suffix: `<56 base32 chars>`
    - v3 host with suffix: `<56 base32 chars>.onion`
    - (legacy) v2 host without suffix: `<16 base32 chars>`
    - (legacy) v2 host with suffix: `<16 base32 chars>.onion`

Notes:

- The adapter chooses SOCKS vs direct based on the `<host>` value.
- The rest of the system should treat the peer URL as opaque and avoid trying to “fix up” `.onion` suffixes; passing either form is supported.

## API

### `createSocketAdapterOrThrow(lib, config?)`

`lib` must provide:

- `createConnection({ host, port }, onConnect?)`
- `createServer((socket) => ...)`

Returns:

- `Net.connect(host, port) -> Promise<Wire>`
- `Net.listen(port, onConnection, host?) -> server`

`Wire` matches the minimal shape Gun expects (`send`, `close`, `onmessage`, `onopen`, `onclose`, `onerror`).

Config highlights:

- `socksHost` (default `127.0.0.1`)
- `socksPort` (default `9050`)
- `handshakeTimeoutMs` (default `10000`)
- bounded buffers / payload sizes to avoid unbounded memory growth

### `socks5HttpGetOrThrow(opts)`

React Native implementation of a bounded SOCKS5 CONNECT + HTTP GET probe. Used by RN E2E tests to verify an onion service is reachable through Tor’s SOCKS port.

## Examples

### Node / Electron: direct protocol TCP

```js
const net = require('net');
const { createSocketAdapterOrThrow } = require('guncelium-protocal');

const Net = createSocketAdapterOrThrow(net, { socksPort: 9050 });

Net.listen(8888, (peer) => {
  peer.onmessage = (msg) => console.log('server got', msg.data);
});

// Direct connect (no SOCKS)
const wire = await Net.connect('127.0.0.1', 8888);
wire.send({ hello: 'world' });
```

### Node / Electron: onion peer over Tor (SOCKS)

```js
const net = require('net');
const { createSocketAdapterOrThrow } = require('guncelium-protocal');

const Net = createSocketAdapterOrThrow(net, { socksHost: '127.0.0.1', socksPort: 9050 });

// Onion host can be with or without .onion
const onionHost = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz234567abcdefghijkl';
const wire = await Net.connect(onionHost, 8888);
wire.send({ ping: 1 });
```

### React Native

```js
import TcpSocket from 'react-native-tcp-socket';
import { createSocketAdapterOrThrow } from 'guncelium-protocal';

// In this app, Tor on RN typically exposes SOCKS on 8765
const Net = createSocketAdapterOrThrow(TcpSocket, { socksHost: '127.0.0.1', socksPort: 8765 });
```
