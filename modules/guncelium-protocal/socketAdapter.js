'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requirePort(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be an integer 1..65535`);
    return n;
}

function requireListenPort(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${name} must be an integer 0..65535`);
    return n;
}

function requireBoolean(value, name) {
    if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
}

function getTextCodecOrThrow() {
    const g = (typeof globalThis !== 'undefined') ? globalThis : null;
    const TE = (g && g.TextEncoder) ? g.TextEncoder : null;
    const TD = (g && g.TextDecoder) ? g.TextDecoder : null;

    if (TE && TD) {
        return { encoder: new TE(), decoder: new TD() };
    }

    // Node.js alternative, still deterministic (not a silent fallback).
    // eslint-disable-next-line global-require
    const u = require('util');
    if (u && typeof u.TextEncoder === 'function' && typeof u.TextDecoder === 'function') {
        return { encoder: new u.TextEncoder(), decoder: new u.TextDecoder() };
    }

    throw new Error('TextEncoder/TextDecoder are required (missing in this runtime)');
}

function toUint8ArrayOrThrow(chunk) {
    if (chunk instanceof Uint8Array) return chunk;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(chunk)) {
        return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    if (chunk && typeof chunk === 'object' && chunk.buffer instanceof ArrayBuffer) {
        // Covers DataView, TypedArrays other than Uint8Array.
        return new Uint8Array(chunk.buffer, chunk.byteOffset || 0, chunk.byteLength || chunk.length || 0);
    }
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    throw new Error('socket data chunk must be Uint8Array/Buffer/ArrayBuffer');
}

function concatUint8OrThrow(a, b, maxBytes) {
    if (!(a instanceof Uint8Array)) throw new Error('concatUint8OrThrow: a must be Uint8Array');
    if (!(b instanceof Uint8Array)) throw new Error('concatUint8OrThrow: b must be Uint8Array');
    const max = Number(maxBytes);
    if (!Number.isFinite(max) || max <= 0) throw new Error('concatUint8OrThrow: maxBytes must be positive');
    const nextLen = a.length + b.length;
    if (nextLen > max) throw new Error(`buffer exceeded maxBytes (${nextLen} > ${max})`);
    const out = new Uint8Array(nextLen);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function createHeaderOrThrow(length, type) {
    const len = Number(length);
    const t = Number(type);
    if (!Number.isInteger(len) || len < 0) throw new Error('frame length must be a non-negative integer');
    if (!Number.isInteger(t) || t < 1 || t > 255) throw new Error('frame type must be 1..255');

    const header = new Uint8Array(5);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    view.setUint32(0, len, false);
    view.setUint8(4, t);
    return header;
}

function parseHeaderOrThrow(buf, offset) {
    if (!(buf instanceof Uint8Array)) throw new Error('parseHeaderOrThrow: buf must be Uint8Array');
    const off = Number(offset);
    if (!Number.isInteger(off) || off < 0) throw new Error('parseHeaderOrThrow: offset must be a non-negative integer');
    if (off + 5 > buf.length) throw new Error('parseHeaderOrThrow: insufficient header bytes');

    const view = new DataView(buf.buffer, buf.byteOffset + off, 5);
    const len = view.getUint32(0, false);
    const type = view.getUint8(4);
    return { len, type };
}

const TYPES = Object.freeze({
    BINARY: 1,
    HEARTBEAT: 2,
    MESSAGE: 3,
});

const DEFAULT_CONFIG = Object.freeze({
    heartbeatIntervalMs: 20000,
    idleTimeoutMs: 60000,
    maxPayloadBytes: 10 * 1024 * 1024,
    maxBufferedBytes: 12 * 1024 * 1024,
    maxFramesPerChunk: 256,
    socksHost: '127.0.0.1',
    socksPort: 9050,
    handshakeTimeoutMs: 10000,
});

function normalizeConfigOrThrow(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {};

    const heartbeatIntervalMs = (c.heartbeatIntervalMs === undefined) ? DEFAULT_CONFIG.heartbeatIntervalMs : Number(c.heartbeatIntervalMs);
    const idleTimeoutMs = (c.idleTimeoutMs === undefined) ? DEFAULT_CONFIG.idleTimeoutMs : Number(c.idleTimeoutMs);
    const maxPayloadBytes = (c.maxPayloadBytes === undefined) ? DEFAULT_CONFIG.maxPayloadBytes : Number(c.maxPayloadBytes);
    const maxBufferedBytes = (c.maxBufferedBytes === undefined) ? DEFAULT_CONFIG.maxBufferedBytes : Number(c.maxBufferedBytes);
    const maxFramesPerChunk = (c.maxFramesPerChunk === undefined) ? DEFAULT_CONFIG.maxFramesPerChunk : Number(c.maxFramesPerChunk);
    const socksHost = (c.socksHost === undefined) ? DEFAULT_CONFIG.socksHost : String(c.socksHost);
    const socksPort = (c.socksPort === undefined) ? DEFAULT_CONFIG.socksPort : requirePort(c.socksPort, 'socksPort');
    const handshakeTimeoutMs = (c.handshakeTimeoutMs === undefined) ? DEFAULT_CONFIG.handshakeTimeoutMs : Number(c.handshakeTimeoutMs);

    if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) throw new Error('heartbeatIntervalMs must be positive');
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) throw new Error('idleTimeoutMs must be positive');
    if (!Number.isFinite(maxPayloadBytes) || maxPayloadBytes <= 0) throw new Error('maxPayloadBytes must be positive');
    if (!Number.isFinite(maxBufferedBytes) || maxBufferedBytes <= 0) throw new Error('maxBufferedBytes must be positive');
    if (maxBufferedBytes < maxPayloadBytes + 5) throw new Error('maxBufferedBytes must be >= maxPayloadBytes + 5');
    if (!Number.isInteger(maxFramesPerChunk) || maxFramesPerChunk < 1 || maxFramesPerChunk > 4096) throw new Error('maxFramesPerChunk must be 1..4096');
    requireString(socksHost, 'socksHost');
    if (!Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs <= 0) throw new Error('handshakeTimeoutMs must be positive');

    return {
        heartbeatIntervalMs,
        idleTimeoutMs,
        maxPayloadBytes,
        maxBufferedBytes,
        maxFramesPerChunk,
        socksHost,
        socksPort,
        handshakeTimeoutMs,
    };
}

function createSocketAdapterOrThrow(lib, cfg) {
    requireObject(lib, 'lib');
    requireFunction(lib.createConnection, 'lib.createConnection');
    requireFunction(lib.createServer, 'lib.createServer');

    const config = normalizeConfigOrThrow(cfg);
    const { encoder, decoder } = getTextCodecOrThrow();

    function wrapRawSocketOrThrow(raw, options) {
        requireObject(raw, 'raw');
        requireFunction(raw.on, 'raw.on');
        requireFunction(raw.write, 'raw.write');
        const destroyFn = raw.destroy || raw.end;
        requireFunction(destroyFn, 'raw.destroy/raw.end');

        let readyState = 0; // 0 CONNECTING, 1 OPEN, 3 CLOSED
        let lastSeen = Date.now();
        let buffer = new Uint8Array(0);
        let bufferedAmount = 0;
        let pulse = null;

        const api = {
            readyState,
            bufferedAmount,
            onmessage: null,
            onopen: null,
            onclose: null,
            onerror: null,
            send: null,
            close: null,
        };

        function emitError(err) {
            if (api.onerror) api.onerror(err);
        }

        function doClose() {
            if (readyState === 3) return;
            readyState = 3;
            api.readyState = readyState;
            if (pulse) {
                clearInterval(pulse);
                pulse = null;
            }
            try {
                destroyFn.call(raw);
            } catch (e) {
                // destroy must not throw; if it does, surface it.
                emitError(e);
            }
            if (api.onclose) api.onclose();
        }

        function writeRawOrThrow(u8) {
            if (!(u8 instanceof Uint8Array)) throw new Error('writeRawOrThrow expects Uint8Array');
            const ok = raw.write(u8);
            if (ok === false) bufferedAmount += u8.length;
            api.bufferedAmount = bufferedAmount;
        }

        function encodeFrameOrThrow(data, type) {
            const header = createHeaderOrThrow(data ? data.length : 0, type);
            const payload = data || new Uint8Array(0);
            const out = new Uint8Array(header.length + payload.length);
            out.set(header, 0);
            out.set(payload, header.length);
            return out;
        }

        function sendOrThrow(data) {
            if (readyState !== 1) throw new Error('socket is not open');
            const isBinary = data instanceof Uint8Array;
            const isString = (typeof data === 'string');
            const payload = isBinary
                ? data
                : (isString ? encoder.encode(data) : encoder.encode(JSON.stringify(data)));
            const type = isBinary ? TYPES.BINARY : TYPES.MESSAGE;
            const framed = encodeFrameOrThrow(payload, type);
            writeRawOrThrow(framed);
        }

        function decodeFramesOrThrow(chunkU8) {
            const combined = concatUint8OrThrow(buffer, chunkU8, config.maxBufferedBytes);
            let offset = 0;
            let frames = 0;

            while (offset + 5 <= combined.length) {
                if (frames >= config.maxFramesPerChunk) {
                    throw new Error('too many frames in one chunk');
                }
                const { len, type } = parseHeaderOrThrow(combined, offset);
                if (len > config.maxPayloadBytes) {
                    throw new Error(`frame too large (${len} > ${config.maxPayloadBytes})`);
                }
                const end = offset + 5 + len;
                if (end > combined.length) break;

                const payload = combined.slice(offset + 5, end);
                frames++;

                if (type === TYPES.HEARTBEAT) {
                    // No user-facing message.
                } else if (type === TYPES.BINARY) {
                    if (api.onmessage) api.onmessage({ data: payload });
                } else if (type === TYPES.MESSAGE) {
                    const text = decoder.decode(payload);
                    let obj;
                    try {
                        obj = JSON.parse(text);
                    } catch (e) {
                        throw new Error('invalid JSON payload');
                    }
                    if (api.onmessage) {
                        // Gun's mesh batches messages as JSON arrays in a single string like: "[ {...},{...} ]".
                        // If we emit it as an actual Array, mesh.hear() will not treat it as a batch.
                        api.onmessage({ data: Array.isArray(obj) ? text : obj });
                    }
                } else {
                    throw new Error(`unknown frame type ${type}`);
                }

                offset = end;
            }

            buffer = combined.slice(offset);
        }

        function initOpen() {
            readyState = 1;
            api.readyState = readyState;

            pulse = setInterval(() => {
                const idleMs = Date.now() - lastSeen;
                if (idleMs > config.idleTimeoutMs) {
                    doClose();
                    return;
                }
                try {
                    writeRawOrThrow(encodeFrameOrThrow(null, TYPES.HEARTBEAT));
                } catch (e) {
                    emitError(e);
                    doClose();
                }
            }, config.heartbeatIntervalMs);

            raw.on('data', (c) => {
                try {
                    const u8 = toUint8ArrayOrThrow(c);
                    lastSeen = Date.now();
                    decodeFramesOrThrow(u8);
                } catch (e) {
                    emitError(e);
                    doClose();
                }
            });

            raw.on('drain', () => {
                bufferedAmount = 0;
                api.bufferedAmount = bufferedAmount;
            });

            raw.on('close', () => {
                doClose();
            });

            raw.on('error', (err) => {
                emitError(err instanceof Error ? err : new Error(String(err)));
                doClose();
            });

            setTimeout(() => {
                if (api.onopen) api.onopen();
            }, 0);
        }

        function socks5HandshakeOrThrow(onion, port) {
            requireString(onion, 'onion');
            const p = requirePort(port, 'port');

            let step = 0;
            let hsBuf = new Uint8Array(0);
            let done = false;

            const timeout = setTimeout(() => {
                if (done) return;
                done = true;
                emitError(new Error('SOCKS5 handshake timeout'));
                doClose();
            }, config.handshakeTimeoutMs);

            function cleanup() {
                clearTimeout(timeout);
                if (typeof raw.removeListener === 'function') {
                    raw.removeListener('data', onHandshakeData);
                    raw.removeListener('error', onHandshakeError);
                }
            }

            function onHandshakeError(err) {
                if (done) return;
                done = true;
                cleanup();
                emitError(err instanceof Error ? err : new Error(String(err)));
                doClose();
            }

            function onHandshakeData(c) {
                if (done) return;
                try {
                    const u8 = toUint8ArrayOrThrow(c);
                    hsBuf = concatUint8OrThrow(hsBuf, u8, 512);

                    // Step 0: auth response is 2 bytes.
                    if (step === 0) {
                        if (hsBuf.length < 2) return;
                        if (hsBuf[0] !== 0x05 || hsBuf[1] !== 0x00) throw new Error('SOCKS5 auth rejected');
                        hsBuf = hsBuf.slice(2);
                        step = 1;

                        const domainBuf = encoder.encode(onion);
                        if (domainBuf.length < 1 || domainBuf.length > 255) throw new Error('onion domain length invalid');
                        const req = new Uint8Array(7 + domainBuf.length);
                        req.set([0x05, 0x01, 0x00, 0x03, domainBuf.length], 0);
                        req.set(domainBuf, 5);
                        const view = new DataView(req.buffer, req.byteOffset, req.byteLength);
                        view.setUint16(req.length - 2, p, false);
                        writeRawOrThrow(req);
                    }

                    // Step 1: connect reply is at least 2 bytes, but includes address fields.
                    if (step === 1) {
                        if (hsBuf.length < 2) return;
                        if (hsBuf[0] !== 0x05) throw new Error('SOCKS5 invalid response');
                        if (hsBuf[1] !== 0x00) throw new Error(`SOCKS5 connect failed: code ${hsBuf[1]}`);

                        done = true;
                        cleanup();
                        initOpen();
                    }
                } catch (e) {
                    done = true;
                    cleanup();
                    emitError(e instanceof Error ? e : new Error(String(e)));
                    doClose();
                }
            }

            raw.on('data', onHandshakeData);
            raw.on('error', onHandshakeError);

            // Start: auth method negotiation (no auth)
            writeRawOrThrow(new Uint8Array([0x05, 0x01, 0x00]));
        }

        api.send = (data) => sendOrThrow(data);
        api.close = () => doClose();

        const wantsTor = !!(options && options.onion);
        if (options !== undefined && options !== null) requireObject(options, 'options');
        if (wantsTor) {
            socks5HandshakeOrThrow(String(options.onion), Number(options.port));
        } else {
            initOpen();
        }

        return api;
    }

    function connect(address, port) {
        requireString(address, 'address');
        const p = requirePort(port, 'port');
        const isOnion = address.endsWith('.onion');

        const rawOptions = isOnion
            ? { host: config.socksHost, port: config.socksPort }
            : { host: address, port: p };

        return new Promise((resolve, reject) => {
            const raw = lib.createConnection(rawOptions, () => {
                try {
                    const wrapped = wrapRawSocketOrThrow(raw, isOnion ? { onion: address, port: p } : {});
                    wrapped.onerror = (err) => reject(err);
                    wrapped.onopen = () => resolve(wrapped);
                } catch (e) {
                    reject(e);
                }
            });
            if (raw && typeof raw.on === 'function') {
                raw.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
            }
        });
    }

    function listen(port, onConnection, host) {
        const p = requireListenPort(port, 'port');
        const h = (host === undefined || host === null) ? '0.0.0.0' : String(host);
        requireString(h, 'host');
        if (onConnection !== undefined && onConnection !== null) {
            requireFunction(onConnection, 'onConnection');
        }

        const server = lib.createServer((rawSocket) => {
            const peer = wrapRawSocketOrThrow(rawSocket, {});
            if (onConnection) onConnection(peer);
        });
        requireObject(server, 'server');
        requireFunction(server.listen, 'server.listen');

        server.listen({ host: h, port: p }, () => {
            const a = (server && typeof server.address === 'function') ? server.address() : null;
            const boundPort = (a && typeof a === 'object' && a.port) ? a.port : p;
            // eslint-disable-next-line no-console
            console.log(`[Socket] Server listening on ${h}:${boundPort}`);
        });
        return server;
    }

    return {
        TYPES,
        connect,
        listen,
    };
}

module.exports = {
    createSocketAdapterOrThrow,
    TYPES,
    DEFAULT_CONFIG,
};
