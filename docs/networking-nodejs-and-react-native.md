

# Cross-Platform Tor Mesh Network Guide

This guide provides a unified implementation for a decentralized TCP mesh network. It solves cross-platform bundler issues (Metro/Webpack) by using **dependency injection**: you initialize the module *once* with your platform's socket library.


## 1. The Core Engine (SocketAdapter.js)

This file exports a factory function. It returns a connect function for clients and a listen function for servers, handling all Tor SOCKS5 handshakes and binary framing internally.

```js
const encoder = new TextEncoder(); 
const decoder = new TextDecoder(); 
 
/** 
 * Initialize the Socket Adapter with a specific networking library. 
 * @param {object} lib - Node.js 'net' or 'react-native-tcp-socket' 
 */ 
export default function createSocketAdapter(lib) { 
  if (!lib) throw new Error("Networking library is required (net or react-native-tcp-socket)"); 
 
  /** 
   * Internal wrapper class handling Framing, Heartbeats, and Tor 
   */ 
  class SocketAdapter { 
    static TYPES = { BINARY: 1, HEARTBEAT: 2, MESSAGE: 3 }; 
    static CONFIG = {  
      INTERVAL: 20000,  
      TIMEOUT: 60000,  
      MAX_PAYLOAD: 10 * 1024 * 1024  
    }; 
 
    constructor(socket, options = {}) { 
      this.socket = socket; 
      this.lastSeen = Date.now(); 
      this.buffer = new Uint8Array(0); 
      this.readyState = 0; // 0 = CONNECTING, 1 = OPEN, 3 = CLOSED 
      this.bufferedAmount = 0; 
       
      this.onmessage = null; 
      this.onopen = null; 
      this.onclose = null; 
      this.onerror = null; 
 
      // Handle Tor Handshake or Direct Init 
      if (options.onion) { 
        this._handshake(options.onion, options.port || 8888); 
      } else { 
        this._init(); 
      } 
    } 
 
    _handshake(targetOnion, targetPort) { 
      let step = 0; 
      this._writeRaw(new Uint8Array([0x05, 0x01, 0x00])); 
 
      const onHandshakeData = (data) => { 
        if (step === 0) { 
          if (data.length &lt; 2 || data[0] !== 0x05 || data[1] !== 0x00) { 
            return this._fail('SOCKS5 Auth Rejected'); 
          } 
          step = 1; 
          const domainBuf = encoder.encode(targetOnion); 
          const request = new Uint8Array(7 + domainBuf.length); 
          request.set([0x05, 0x01, 0x00, 0x03, domainBuf.length]); 
          request.set(domainBuf, 5); 
          const view = new DataView(request.buffer, request.byteOffset, request.byteLength); 
          view.setUint16(request.length - 2, targetPort, false); 
          this._writeRaw(request); 
          return; 
        } 
        if (step === 1) { 
          if (data.length &lt; 2 || data[0] !== 0x05 || data[1] !== 0x00) { 
             return this._fail(`SOCKS5 Connect Failed: Code ${data[1]}`); 
          } 
          this.socket.removeListener('data', onHandshakeData); 
          console.log(`[Socket] Tor Tunnel established to ${targetOnion}`); 
          this._init(); 
        } 
      }; 
 
      this.socket.on('data', onHandshakeData); 
      this.socket.on('error', (err) => this._fail(err.message)); 
    } 
 
    _fail(reason) { 
      this.socket.destroy(); 
      if (this.onerror) this.onerror(new Error(reason)); 
    } 
 
    _init() { 
      this.readyState = 1;  
 
      this.pulse = setInterval(() => { 
        if (Date.now() - this.lastSeen > SocketAdapter.CONFIG.TIMEOUT) return this.close(); 
        this._write(this._encode(null, SocketAdapter.TYPES.HEARTBEAT)); 
      }, SocketAdapter.CONFIG.INTERVAL); 
 
      this.socket.on('data', (chunk) => { 
        const combined = new Uint8Array(this.buffer.length + chunk.length); 
        combined.set(this.buffer);  
        combined.set(chunk, this.buffer.length); 
        this.buffer = this._decode(combined, (msg) => { 
          this.lastSeen = Date.now(); 
          if (this.onmessage) this.onmessage({ data: msg.data }); 
        }); 
      }); 
 
      this.socket.on('drain', () => { this.bufferedAmount = 0; }); 
      this.socket.on('close', () => this.close()); 
      this.socket.on('error', (err) => { 
        if (this.onerror) this.onerror(err); 
        this.close(); 
      }); 
 
      // Async open trigger 
      setTimeout(() => { if(this.onopen) this.onopen(); }, 0); 
    } 
 
    _writeRaw(data) { if (!this.socket.destroyed) this.socket.write(data); } 
     
    _write(data) { 
      if (this.socket.destroyed) return false; 
      const success = this.socket.write(data); 
      if (!success) this.bufferedAmount += data.length; 
      return success; 
    } 
 
    send(data) { 
      if (this.readyState !== 1) return; 
      const encoded = (data instanceof Uint8Array)  
        ? this._encode(data, SocketAdapter.TYPES.BINARY) 
        : this._encode(data, SocketAdapter.TYPES.MESSAGE); 
      this._write(encoded); 
    } 
 
    close() { 
      if (this.readyState === 3) return; 
      this.readyState = 3; 
      if (this.pulse) clearInterval(this.pulse); 
      this.socket.destroy(); 
      if (this.onclose) this.onclose(); 
    } 
 
    _encode(data, type) { 
      let payload = type === SocketAdapter.TYPES.MESSAGE ? encoder.encode(JSON.stringify(data)) : (data || new Uint8Array(0)); 
      const header = new ArrayBuffer(5); 
      new DataView(header).setUint32(0, payload.length, false); 
      new DataView(header).setUint8(4, type); 
      const combined = new Uint8Array(5 + payload.length); 
      combined.set(new Uint8Array(header), 0); 
      combined.set(payload, 5); 
      return combined; 
    } 
 
    _decode(uint8Array, onMessage) { 
      let offset = 0; 
      while (offset + 5 &lt;= uint8Array.length) { 
        const view = new DataView(uint8Array.buffer, uint8Array.byteOffset + offset, 5); 
        const length = view.getUint32(0, false); 
        const type = view.getUint8(4); 
 
        if (length > SocketAdapter.CONFIG.MAX_PAYLOAD) { 
          this.close(); 
          return new Uint8Array(0);  
        } 
 
        if (offset + 5 + length &lt;= uint8Array.length) { 
          const payload = uint8Array.slice(offset + 5, offset + 5 + length); 
          if (type === SocketAdapter.TYPES.MESSAGE) { 
            try { onMessage({ data: JSON.parse(decoder.decode(payload)) }); } catch (e) {} 
          } else if (type === SocketAdapter.TYPES.BINARY) { 
            onMessage({ data: payload }); 
          } 
          offset += 5 + length; 
        } else break; 
      } 
      return uint8Array.slice(offset); 
    } 
  } 
 
  // --- Public API --- 
 
  return { 
    /** 
     * Connect to a peer (Client Mode) 
     * @param {string} address - IP, Domain, or .onion 
     * @param {number} port - Port number 
     * @returns {Promise&lt;SocketAdapter>} 
     */ 
    connect: (address, port) => { 
      const isOnion = address.endsWith('.onion'); 
      const options = isOnion ? { host: '127.0.0.1', port: 9050 } : { host: address, port }; 
 
      return new Promise((resolve, reject) => { 
        const raw = lib.createConnection(options, () => { 
          const ws = new SocketAdapter(raw, isOnion ? { onion: address, port } : {}); 
          ws.onopen = () => resolve(ws); 
        }); 
        raw.on('error', reject); 
      }); 
    }, 
 
    /** 
     * Listen for incoming connections (Server Mode) 
     * @param {number} port - Port to listen on (e.g. 8888) 
     * @param {function(SocketAdapter)} onConnection - Callback for new peers 
     * @returns {object} The raw server instance 
     */ 
    listen: (port, onConnection) => { 
      const server = lib.createServer((rawSocket) => { 
        // Incoming connection! Wrap it immediately. 
        const peer = new SocketAdapter(rawSocket); 
        if (onConnection) onConnection(peer); 
      }); 
       
      server.listen(port, () => { 
        console.log(`[Socket] Server listening on port ${port}`); 
      }); 
       
      return server; 
    } 
  }; 
} 
```


## 2. Usage Examples


### A. React Native (App.js)
```js
import React, { useEffect } from 'react'; 
import TcpSocket from 'react-native-tcp-socket'; 
import createSocketAdapter from './SocketAdapter'; 
 
// 1. Initialize the Adapter with the React Native library 
const Net = createSocketAdapter(TcpSocket); 
 
export default function App() { 
  useEffect(() => { 
    // Start Server 
    const server = Net.listen(8888, (peer) => { 
      console.log('New peer connected!'); 
      peer.onmessage = (msg) => console.log('Server received:', msg.data); 
    }); 
 
    // Connect to a Tor Peer 
    async function connectToTor() { 
      try { 
        const peer = await Net.connect('vww6ybal4bd7szmgncyruucpg.onion', 8888); 
        peer.send({ msg: 'Hello from RN!' }); 
      } catch (err) { 
        console.error(err); 
      } 
    } 
     
    connectToTor(); 
 
    return () => server.close(); 
  }, []); 
 
  return null; 
} 
```


### B. Node.js (index.js)
```js
import net from 'net'; 
import createSocketAdapter from './SocketAdapter.js'; 
 
// 1. Initialize the Adapter with Node's net library 
const Net = createSocketAdapter(net); 
 
// Start Server 
Net.listen(8888, (peer) => { 
  console.log('[Node] Incoming peer connection'); 
  peer.send({ status: 'Welcome to the Node Gateway' }); 
}); 
 
// Connect to a LAN Peer 
Net.connect('192.168.1.50', 8888) 
  .then(peer => { 
    console.log('[Node] Connected to LAN peer'); 
    peer.send({ type: 'handshake', id: 'node-1' }); 
  }) 
  .catch(err => console.error('Connection failed', err)); 

```

