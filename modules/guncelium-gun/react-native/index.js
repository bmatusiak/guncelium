'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireArray(value, name) {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}

function requireObjectLike(value, name) {
    const t = typeof value;
    if (!value || (t !== 'object' && t !== 'function')) throw new Error(`${name} must be an object or function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requireInteger(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
    return n;
}

function requireListenPort(value, name) {
    const n = requireInteger(value, name);
    if (n < 0 || n > 65535) throw new Error(`${name} must be in 0..65535`);
    return n;
}

function requirePort(value, name) {
    const n = requireInteger(value, name);
    if (n < 1 || n > 65535) throw new Error(`${name} must be in 1..65535`);
    return n;
}

function parseTcpPeerOrThrow(s) {
    requireString(s, 'peer');
    const stripped = String(s).trim().replace(/^tcp:\/\//, '');
    const m = stripped.match(/^(.+?):(\d{1,5})$/);
    if (!m) throw new Error(`peer must be tcp://host:port (or host:port), got: ${String(s)}`);
    const host = String(m[1] || '').trim();
    requireString(host, 'peer.host');
    const port = requirePort(m[2], 'peer.port');
    return { host, port, url: `tcp://${host}:${port}` };
}

function stripOnionSuffix(s) {
    const raw = String(s || '').trim();
    return raw.toLowerCase().endsWith('.onion') ? raw.slice(0, -6) : raw;
}

function createPeerIdOrThrow(prefix, n) {
    requireString(prefix, 'prefix');
    const i = requireInteger(n, 'n');
    const ts = Date.now();
    return `${prefix}-${String(ts)}-${String(i)}`;
}

function requireGunMeshOrThrow(gun) {
    requireObjectLike(gun, 'gun');
    const opt = gun._ && gun._.opt;
    if (!opt || typeof opt !== 'object') throw new Error('gun opt missing');
    const mesh = opt.mesh;
    if (!mesh || typeof mesh !== 'function') throw new Error('gun mesh missing');
    if (typeof mesh.hear !== 'function') throw new Error('gun mesh.hear missing');
    if (typeof mesh.hi !== 'function') throw new Error('gun mesh.hi missing');
    if (typeof mesh.bye !== 'function') throw new Error('gun mesh.bye missing');
    return mesh;
}

function attachWireToPeerOrThrow(mesh, peer, wire) {
    if (typeof mesh !== 'function') throw new Error('mesh must be a function');
    requireObject(peer, 'peer');
    requireObject(wire, 'wire');

    peer.wire = wire;
    wire.onmessage = (ev) => {
        if (!ev) throw new Error('wire message event missing');
        mesh.hear(ev.data, peer);
    };
    wire.onopen = () => {
        mesh.hi(peer);
    };
    wire.onclose = () => {
        mesh.bye(peer);
    };
    wire.onerror = () => {
        mesh.bye(peer);
    };
}

function crashAsyncOrThrow(e) {
    const err = (e instanceof Error) ? e : new Error(String(e));
    setTimeout(() => { throw err; }, 0);
    throw err;
}

function isDoubleConnectError(e) {
    return !!(e && typeof e === 'object' && e.code === 'GUNCELIUM_DOUBLE_CONNECT');
}

async function waitForServerListeningOrThrow(server) {
    requireObject(server, 'server');
    if (typeof server.once !== 'function') throw new Error('server.once must be a function');
    if (typeof server.listening === 'boolean' && server.listening) return;

    await new Promise((resolve, reject) => {
        const onError = (err) => {
            server.removeListener('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
    });
}

function normalizePeersOrThrow(peers) {
    if (peers === undefined || peers === null) return [];
    requireArray(peers, 'opts.peers');

    const out = [];
    for (let i = 0; i < peers.length; i++) {
        const raw = peers[i];
        if (raw === undefined || raw === null) continue;
        requireString(raw, 'peer');
        const s = String(raw).trim();
        if (!s) continue;
        out.push(s);
        if (out.length >= 32) throw new Error('opts.peers exceeds limit (32)');
    }
    return out;
}

function ensureNativeSeaInstalledOrThrow(Gun) {
    if (!Gun) throw new Error('Gun is required');

    const root = (typeof globalThis !== 'undefined')
        ? globalThis
        : ((typeof global !== 'undefined') ? global : null);
    if (!root || typeof root !== 'object') throw new Error('global root not available');
    if (!root.window) root.window = root;

    // eslint-disable-next-line global-require
    const nativeSeaImport = require('native-sea');
    const nativeSea = (nativeSeaImport && nativeSeaImport.default) ? nativeSeaImport.default : nativeSeaImport;
    if (!nativeSea || typeof nativeSea.install !== 'function') throw new Error('native-sea.install must be a function');

    // The installer is idempotent (checks Gun.RN).
    nativeSea.install(Gun);

    if (!Gun.SEA) throw new Error('Gun.SEA must be available after installing native-sea');
    if (Gun.RN !== true) throw new Error('native-sea did not set Gun.RN');
}

function createGunReactNativeApiOrThrow() {
    // DONT EDIT THESE REQUIRE LINES BELOW HERE (keeps Metro/bundlers happy)
    // eslint-disable-next-line global-require
    const Gun = require('gun/gun');
    // eslint-disable-next-line global-require
    require('gun/sea.js');

    ensureNativeSeaInstalledOrThrow(Gun);

    const state = {
        gun: null,
        peers: [],
        tcp: {
            server: null,
            port: null,
            gun: null,
            peers: [],
            socksPort: 8765,
        },
    };

    function requireTimeoutMs(value, name) {
        if (value === undefined || value === null) return 5000;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || n > 10000) throw new Error(`${name} must be 1..10000`);
        return n;
    }

    function requireKey(value) {
        requireString(value, 'key');
        const k = String(value).trim();
        if (k.length > 512) throw new Error('key exceeds max length (512)');
        return k;
    }

    function assertTcpRunningOrThrow() {
        if (!state.tcp.server || !state.tcp.gun) throw new Error('gun tcp not running');
        requireObjectLike(state.tcp.gun, 'tcp.gun');
        if (typeof state.tcp.gun.get !== 'function') throw new Error('tcp.gun.get missing');
    }

    function requireJsonSerializableOrThrow(value) {
        let s = null;
        try {
            s = JSON.stringify(value);
        } catch (e) {
            throw new Error(`value must be JSON-serializable: ${e && e.message ? e.message : String(e)}`);
        }
        if (typeof s !== 'string') throw new Error('value JSON stringify failed');
        const MAX = 32 * 1024;
        if (s.length > MAX) throw new Error(`value exceeds max JSON size (${String(MAX)} bytes)`);
    }

    function get() {
        if (!state.gun) throw new Error('gun not running');
        return state.gun;
    }

    async function start(opts) {
        if (state.gun) throw new Error('gun already running');
        const o = (opts && typeof opts === 'object') ? opts : {};

        // API-compat with Electron: GunPanel passes { port: 0 }.
        // React Native build is a client; only port=0 (or unset) is accepted.
        if (o.port !== undefined && o.port !== null) {
            const p = Number(o.port);
            if (!Number.isInteger(p) || p !== 0) throw new Error('react-native gun does not support hosting (opts.port must be 0)');
        }

        const peers = normalizePeersOrThrow(o.peers);

        const gun = Gun({
            peers,
            localStorage: false,
        });
        requireObjectLike(gun, 'gun');
        if (typeof gun.get !== 'function') throw new Error('gun initialization failed (missing get)');

        state.gun = gun;
        state.peers = peers;

        return { ok: true, running: true, port: null, storeDir: null, peers };
    }

    async function stop() {
        if (!state.gun) throw new Error('gun not running');
        const gun = state.gun;
        state.gun = null;
        state.peers = [];

        requireObjectLike(gun, 'gun');
        if (typeof gun.off !== 'function') throw new Error('gun.off must be a function to stop gun');
        gun.off();

        return { ok: true, running: false };
    }

    async function status() {
        return {
            ok: true,
            running: !!state.gun,
            port: null,
            storeDir: null,
            peers: state.peers,
            mode: 'react-native',
            nativeSea: true,
        };
    }

    async function tcpStart(opts) {
        if (state.tcp.server) throw new Error('gun tcp already running');
        const o = (opts && typeof opts === 'object') ? opts : {};
        const desiredPort = (o.port === undefined || o.port === null) ? 0 : requireListenPort(o.port, 'opts.port');
        const host = (o.host === undefined || o.host === null) ? '127.0.0.1' : String(o.host);
        requireString(host, 'opts.host');
        const socksPort = (o.socksPort === undefined || o.socksPort === null) ? 8765 : requirePort(o.socksPort, 'opts.socksPort');
        const peers = normalizePeersOrThrow(o.peers);
        const peerId = (o.peerId === undefined || o.peerId === null) ? createPeerIdOrThrow('tcp-peer', 1) : String(o.peerId);
        requireString(peerId, 'opts.peerId');

        // eslint-disable-next-line global-require
        const TcpSocket = require('react-native-tcp-socket');
        if (!TcpSocket || typeof TcpSocket.createConnection !== 'function') throw new Error('react-native-tcp-socket.createConnection is required');
        if (typeof TcpSocket.createServer !== 'function') throw new Error('react-native-tcp-socket.createServer is required');

        // eslint-disable-next-line global-require
        const { createSocketAdapterOrThrow } = require('guncelium-protocal');
        if (typeof createSocketAdapterOrThrow !== 'function') throw new Error('guncelium-protocal.createSocketAdapterOrThrow is required');

        const socket = createSocketAdapterOrThrow(TcpSocket, {
            socksHost: '127.0.0.1',
            socksPort,
            handshakeTimeoutMs: 60000,
            enableHello: true,
            peerId,
            helloTimeoutMs: 5000,
        });

        const gun = Gun({ peers: [], localStorage: false });
        requireObjectLike(gun, 'gun');
        if (typeof gun.get !== 'function') throw new Error('gun initialization failed (missing get)');

        const mesh = requireGunMeshOrThrow(gun);

        // Outgoing wire: connect using the framed TCP protocol.
        mesh.wire = (peer) => {
            requireObject(peer, 'peer');
            if (peer.wire) return;
            if (!peer.url) throw new Error('peer.url is required');

            const parsed = parseTcpPeerOrThrow(String(peer.url));
            peer.url = parsed.url;

            socket.connect(parsed.host, parsed.port).then((wire) => {
                attachWireToPeerOrThrow(mesh, peer, wire);
            }).catch((e) => {
                if (isDoubleConnectError(e)) return;
                crashAsyncOrThrow(e);
            });
        };

        // Incoming: accept framed TCP wires.
        let inbound = 0;
        const server = socket.listen(desiredPort, (wire) => {
            inbound += 1;
            if (inbound > 128) throw new Error('too many inbound tcp peers (128)');
            const peer = { id: null, url: createPeerIdOrThrow('tcp-in', inbound), wire: null };
            attachWireToPeerOrThrow(mesh, peer, wire);
        }, host);

        await waitForServerListeningOrThrow(server);

        const addr = (server && typeof server.address === 'function') ? server.address() : null;
        const boundPort = (addr && typeof addr === 'object' && addr.port) ? requirePort(addr.port, 'server.address().port') : null;
        if (!boundPort) throw new Error('gun tcp server missing bound port');

        for (let i = 0; i < peers.length; i++) {
            const t = parseTcpPeerOrThrow(peers[i]);
            if (peerId) {
                const local = stripOnionSuffix(peerId);
                const remote = stripOnionSuffix(t.host);
                if (local && remote && local === remote) continue;
            }
            mesh.hi({ url: t.url, id: t.url });
        }

        state.tcp.server = server;
        state.tcp.port = boundPort;
        state.tcp.gun = gun;
        state.tcp.peers = peers;
        state.tcp.socksPort = socksPort;
        state.tcp.peerId = peerId;

        return { ok: true, running: true, port: boundPort, host, peers, socksPort, peerId };
    }

    async function tcpStop() {
        if (!state.tcp.server) throw new Error('gun tcp not running');
        const s = state.tcp.server;
        await new Promise((resolve, reject) => {
            if (typeof s.close !== 'function') return reject(new Error('tcp server.close is required'));
            s.close((err) => (err ? reject(err) : resolve()));
        });
        state.tcp.server = null;
        state.tcp.port = null;
        state.tcp.gun = null;
        state.tcp.peers = [];
        return { ok: true, running: false };
    }

    async function tcpStatus() {
        return {
            ok: true,
            running: !!state.tcp.server,
            port: state.tcp.port,
            peers: state.tcp.peers,
            socksPort: state.tcp.socksPort,
            peerId: state.tcp.peerId || null,
            mode: 'react-native',
        };
    }

    async function tcpPut(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const key = requireKey(o.key);
        requireJsonSerializableOrThrow(o.value);
        assertTcpRunningOrThrow();

        state.tcp.gun.get(key).put(o.value);

        return { ok: true };
    }

    async function tcpOnce(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const key = requireKey(o.key);
        const timeoutMs = requireTimeoutMs(o.timeoutMs, 'timeoutMs');
        assertTcpRunningOrThrow();

        const data = await new Promise((resolve, reject) => {
            let done = false;
            const t = setTimeout(() => {
                if (done) return;
                done = true;
                reject(new Error('timeout waiting for gun.once'));
            }, timeoutMs);

            state.tcp.gun.get(key).once((v) => {
                if (done) return;
                done = true;
                clearTimeout(t);
                resolve(v);
            });
        });

        return { ok: true, data };
    }

    return {
        start,
        stop,
        status,
        get,
        tcpStart,
        tcpStop,
        tcpStatus,
        tcpPut,
        tcpOnce,
    };
}

module.exports = createGunReactNativeApiOrThrow;
