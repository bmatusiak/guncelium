# guncelium-protocal

Cross-platform TCP framing + Tor SOCKS5 handshake adapter.

This package implements the protocol described in `docs/networking-nodejs-and-react-native.md` (generated design).

- Framing: 4-byte big-endian length + 1-byte type, then payload
- Types:
  - 1 = BINARY (Uint8Array payload)
  - 2 = HEARTBEAT (empty)
  - 3 = MESSAGE (JSON payload)

Usage (Node):

```js
const net = require('net');
const { createSocketAdapterOrThrow } = require('guncelium-protocal');

const Net = createSocketAdapterOrThrow(net);
const server = Net.listen(8888, (peer) => {
  peer.onmessage = (msg) => console.log('server got', msg.data);
});
```

Usage (React Native):

```js
import TcpSocket from 'react-native-tcp-socket';
import { createSocketAdapterOrThrow } from 'guncelium-protocal';

const Net = createSocketAdapterOrThrow(TcpSocket);
```
