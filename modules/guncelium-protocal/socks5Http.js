'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requirePositiveInt(value, name, max) {
    const n = Number(value);
    const hi = Number(max);
    if (!Number.isInteger(n) || n <= 0 || n > hi) throw new Error(`${name} must be int 1..${hi}`);
    return n;
}

function requireNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
    return value;
}

function requireTcpSocketOrThrow(TcpSocket) {
    if (!TcpSocket || typeof TcpSocket.createConnection !== 'function') {
        throw new Error('react-native-tcp-socket.createConnection is required');
    }
}

function toBufferOrThrow(value) {
    if (typeof Buffer === 'undefined') throw new Error('global Buffer is required');
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    throw new Error('expected Buffer or Uint8Array');
}

function appendBufferBoundedOrThrow(acc, chunk, maxBytes) {
    const a = toBufferOrThrow(acc);
    const b = toBufferOrThrow(chunk);
    const max = requirePositiveInt(maxBytes, 'maxBytes', 1024 * 1024 * 1024);
    const nextLen = a.length + b.length;
    if (nextLen > max) throw new Error(`buffer exceeded maxBytes=${String(max)}`);
    return Buffer.concat([a, b]);
}

function buildSocks5Greeting() {
    return Buffer.from([0x05, 0x01, 0x00]);
}

function parseSocks5GreetingReplyOrThrow(buf) {
    const b = toBufferOrThrow(buf);
    if (b.length < 2) return null;
    const v = b[0];
    const method = b[1];
    if (v !== 0x05) throw new Error(`SOCKS5 bad version in greeting: ${String(v)}`);
    if (method !== 0x00) throw new Error(`SOCKS5 no-auth not accepted: ${String(method)}`);
    return { consumed: 2 };
}

function buildSocks5ConnectDomainOrThrow(host, port) {
    requireNonEmptyString(host, 'targetHost');
    const targetPort = requirePositiveInt(port, 'targetPort', 65535);

    if (typeof Buffer === 'undefined') throw new Error('global Buffer is required');
    const hostBytes = Buffer.from(host, 'utf8');
    if (hostBytes.length < 1 || hostBytes.length > 255) throw new Error('targetHost must be 1..255 bytes');

    const portHi = (targetPort >> 8) & 0xff;
    const portLo = targetPort & 0xff;

    return Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
        hostBytes,
        Buffer.from([portHi, portLo]),
    ]);
}

function parseSocks5ConnectReplyOrThrow(buf) {
    const b = toBufferOrThrow(buf);
    if (b.length < 5) return null;

    const ver = b[0];
    const rep = b[1];
    const atyp = b[3];

    if (ver !== 0x05) throw new Error(`SOCKS5 bad version in reply: ${String(ver)}`);
    if (rep !== 0x00) throw new Error(`SOCKS5 connect failed rep=${String(rep)}`);

    let headerLen = 0;
    if (atyp === 0x01) headerLen = 4 + 4 + 2;
    else if (atyp === 0x04) headerLen = 4 + 16 + 2;
    else if (atyp === 0x03) {
        if (b.length < 5) return null;
        const addrLen = b[4];
        headerLen = 4 + 1 + addrLen + 2;
    } else {
        throw new Error(`SOCKS5 unknown ATYP=${String(atyp)}`);
    }

    if (b.length < headerLen) return null;
    return { consumed: headerLen };
}

function buildHttpGetRequestOrThrow(host) {
    requireNonEmptyString(host, 'host');
    const reqText = `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
    return Buffer.from(reqText, 'utf8');
}

function parseHttpResponseOrThrow(buf) {
    const b = toBufferOrThrow(buf);
    const text = b.toString('utf8');
    const firstLine = (text.split('\r\n')[0] || '').trim();
    const ok = /^HTTP\/[0-9.]+\s+200\b/.test(firstLine);
    return { ok, statusLine: firstLine, text };
}

async function socks5HttpGetOrThrow(opts) {
    requireObject(opts, 'opts');

    const socksHost = String(opts.socksHost || '127.0.0.1');
    const socksPort = requirePositiveInt(opts.socksPort, 'opts.socksPort', 65535);
    const targetHost = String(opts.targetHost || '').trim();
    if (!targetHost) throw new Error('opts.targetHost must be non-empty');
    const targetPort = requirePositiveInt(opts.targetPort, 'opts.targetPort', 65535);
    const timeoutMs = requirePositiveInt(opts.timeoutMs, 'opts.timeoutMs', 120000);
    const maxBytes = requirePositiveInt(opts.maxBytes, 'opts.maxBytes', 1024 * 1024);

    // eslint-disable-next-line global-require
    const TcpSocket = require('react-native-tcp-socket');
    requireTcpSocketOrThrow(TcpSocket);

    if (typeof Buffer === 'undefined') throw new Error('global Buffer is required');

    return await new Promise((resolve, reject) => {
        let settled = false;
        let phase = 'greeting';
        let inBuf = Buffer.alloc(0);
        let httpBuf = Buffer.alloc(0);
        let timer = null;

        const socket = TcpSocket.createConnection({ host: socksHost, port: socksPort });

        const cleanup = () => {
            try { if (timer) clearTimeout(timer); } catch (_e0) { }
            try { socket.destroy(); } catch (_e1) { }
        };

        const fail = (e) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(e);
        };

        const finish = (value) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };

        timer = setTimeout(() => fail(new Error('SOCKS5 httpGet timeout')), timeoutMs);

        socket.on('error', (e) => {
            const msg = e && e.message ? e.message : String(e);
            fail(new Error(`SOCKS5 socket error: ${msg}`));
        });

        socket.on('close', () => {
            if (phase === 'http') {
                try {
                    finish(parseHttpResponseOrThrow(httpBuf));
                } catch (e) {
                    fail(e);
                }
                return;
            }
            if (!settled) fail(new Error(`SOCKS5 socket closed during phase=${phase}`));
        });

        socket.on('connect', () => {
            socket.write(buildSocks5Greeting());
        });

        socket.on('data', (chunk) => {
            if (settled) return;

            try {
                inBuf = appendBufferBoundedOrThrow(inBuf, chunk, 1024);

                if (phase === 'greeting') {
                    const g = parseSocks5GreetingReplyOrThrow(inBuf);
                    if (!g) return;
                    inBuf = inBuf.slice(g.consumed);
                    socket.write(buildSocks5ConnectDomainOrThrow(targetHost, targetPort));
                    phase = 'connect';
                }

                if (phase === 'connect') {
                    const r = parseSocks5ConnectReplyOrThrow(inBuf);
                    if (!r) return;
                    inBuf = inBuf.slice(r.consumed);
                    socket.write(buildHttpGetRequestOrThrow(targetHost));
                    phase = 'http';
                }

                if (phase === 'http') {
                    httpBuf = appendBufferBoundedOrThrow(httpBuf, inBuf, maxBytes);
                    inBuf = Buffer.alloc(0);
                }
            } catch (e) {
                fail(e);
            }
        });
    });
}

module.exports = {
    socks5HttpGetOrThrow,
};
