## Cross-platform TCP mesh (Node.js + React Native)

This document is for people porting Gun (or writing a custom runtime) and wanting to participate in the Guncelium **framed TCP** mesh, either directly (LAN/WAN) or via Tor `.onion` peers.

The canonical implementation lives in:

- [modules/guncelium-protocal/socketAdapter.js](modules/guncelium-protocal/socketAdapter.js)

This guide explains what that adapter expects and guarantees.

### Design goals

- **Same wire format** across Node and React Native.
- **Dependency injection** for the raw socket library (avoid bundler issues).
- **Fail-fast** behavior: malformed frames, invalid JSON, handshake failures, and exceeded limits terminate the connection.
- **Hard bounds**: maximum frame sizes, maximum buffered bytes, bounded per-chunk decode work.

## Wire format (framed TCP)

All application messages are carried over a TCP stream using a simple framing layer:

- Header: 5 bytes
  - `u32be length` (payload length in bytes)
  - `u8 type` (frame type)
- Payload: `length` bytes

Frame types (from `guncelium-protocal`):

- `1` = `BINARY` (payload is raw bytes)
- `2` = `HEARTBEAT` (payload length must be 0; used to keep idle connections alive)
- `3` = `MESSAGE` (payload is UTF-8 JSON)

### Important Gun compatibility note

Gun mesh sometimes sends a JSON array batch string like `"[{...},{...}]"`.

The adapter preserves this behavior:

- If decoded JSON is an **array**, the adapter emits the **raw JSON string** as `onmessage({ data: text })`.
- Otherwise it emits the parsed object as `onmessage({ data: object })`.

If you change this, Gun may stop treating batches correctly.

## `.onion` dial-out (SOCKS5)

When dialing an address ending in `.onion`, the adapter connects to a local Tor SOCKS5 proxy (default `127.0.0.1:9050`) and performs a SOCKS5 handshake:

- Auth method negotiation: no-auth (`0x00`)
- CONNECT to a **domain name** address type (`0x03`) using the full hostname (including `.onion`)

After the handshake completes, the stream switches to the framed TCP protocol above.

The handshake is bounded:

- A hard timeout (`handshakeTimeoutMs`, default 10s)
- A small handshake buffer cap (512 bytes)

## Runtime requirements

Your platform must provide:

- `TextEncoder` and `TextDecoder` (or equivalent). If not present, the adapter throws.
- A socket library with Node-like methods:
  - `createConnection(options, onConnect)`
  - `createServer(onSocket)`
  - raw socket emits `data`, `close`, `error` events and supports `write()` + `destroy()`/`end()`

## Adapter API

`createSocketAdapterOrThrow(lib, config)` returns:

- `connect(address, port) -> Promise<Wire>`
- `listen(port, onConnection, host?) -> Server`
- `TYPES` (frame type constants)

`Wire` is WebSocket-like:

- `onopen`, `onmessage`, `onclose`, `onerror`
- `send(objOrUint8Array)`
- `close()`

### Configuration knobs

The adapter has strict defaults and supports overrides for ports and bounds:

- `socksHost`, `socksPort`
- `handshakeTimeoutMs`
- `maxPayloadBytes`, `maxBufferedBytes`, `maxFramesPerChunk`
- `heartbeatIntervalMs`, `idleTimeoutMs`

## Minimal usage examples

### Node.js (direct + onion)

```js
const net = require('net');
const { createSocketAdapterOrThrow } = require('guncelium-protocal');

const Net = createSocketAdapterOrThrow(net, {
  socksHost: '127.0.0.1',
  socksPort: 9050,
});

Net.listen(8888, (peer) => {
  peer.onmessage = (m) => {
    // m.data is either an object OR a JSON string for Gun batch arrays.
    console.log('server got', typeof m.data, m.data);
  };
});

Net.connect('exampleonionhostnameeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.onion', 8888)
  .then((peer) => peer.send({ hello: 'from node' }))
  .catch((e) => { throw e; });
```

### React Native (TCP socket DI)

```js
import TcpSocket from 'react-native-tcp-socket';
import { createSocketAdapterOrThrow } from 'guncelium-protocal';

const Net = createSocketAdapterOrThrow(TcpSocket, {
  socksHost: '127.0.0.1',
  socksPort: 9050,
});

export function connectOnceOrThrow(onionHost, virtualPort) {
  return Net.connect(onionHost, virtualPort);
}
```

Notes:

- On mobile, you must start Tor and ensure a reachable SOCKS port before connecting to `.onion` peers.
- For Gun integration, you typically feed `Wire` into Gun mesh as a “wire” (see how Electron does it in `modules/guncelium-gun/main/index.js`).
 

