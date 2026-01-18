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

## Framing protocol

Each frame is:

- 4-byte big-endian payload length
- 1-byte type
- payload bytes

Types:

- `1` = BINARY (`Uint8Array` payload)
- `2` = HEARTBEAT (empty payload)
- `3` = MESSAGE (JSON payload)

## Onion detection rules

The socket adapter treats a destination as an onion service when the host matches:

- Tor v3: 56 base32 chars (`a-z2-7`) with or without the `.onion` suffix
- Tor v2 (legacy): 16 base32 chars with or without the `.onion` suffix

When an onion host is detected, the adapter connects to `socksHost:socksPort` and performs a SOCKS5 CONNECT to `<onion>.onion:<port>`.

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
const wire = await Net.connect('abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz234567abcdefghijkl', 8888);
wire.send({ ping: 1 });
```

### React Native

```js
import TcpSocket from 'react-native-tcp-socket';
import { createSocketAdapterOrThrow } from 'guncelium-protocal';

// In this app, Tor on RN typically exposes SOCKS on 8765
const Net = createSocketAdapterOrThrow(TcpSocket, { socksHost: '127.0.0.1', socksPort: 8765 });
```
