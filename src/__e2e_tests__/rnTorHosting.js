import app from '../runtime/rectifyApp';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function isElectronRenderer() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    const hasDom = (typeof window === 'object' && window && typeof window.document !== 'undefined');
    const hasBridge = !!(root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');
    return hasDom && hasBridge;
}

function isReactNative() {
    if (typeof navigator === 'object' && navigator && navigator.product === 'ReactNative') return true;
    const root = (typeof globalThis !== 'undefined') ? globalThis : null;
    return !!(root && typeof root === 'object' && root.__fbBatchedBridge);
}

function requireValidOnionHost(value) {
    const host = String(value || '').trim();
    if (!/^[a-z2-7]{56}$/i.test(host)) throw new Error(`expected v3 onion base32 hostname, got: ${host}`);
    return host;
}

function parseOnionPortOrThrow(onionAddress) {
    requireString(onionAddress, 'onionAddress');
    const s = String(onionAddress).trim();
    const idx = s.lastIndexOf(':');
    if (idx < 0) throw new Error(`onionAddress must include :port, got: ${s}`);
    const portStr = s.slice(idx + 1).trim();
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid onion port: ${portStr}`);
    return port;
}

function requirePositiveInt(value, name, max) {
    const n = Number(value);
    const hi = Number(max);
    if (!Number.isInteger(n) || n <= 0 || n > hi) throw new Error(`${name} must be int 1..${hi}`);
    return n;
}

function requireBufferLike(value, name) {
    if (!value) throw new Error(`${name} is required`);
    if (typeof value.length !== 'number') throw new Error(`${name} must have length`);
    if (typeof value.slice !== 'function') throw new Error(`${name} must have slice()`);
}

function toAsciiStringOrThrow(buf) {
    requireBufferLike(buf, 'buffer');
    const bytes = (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(buf)) ? buf : null;
    if (bytes) return bytes.toString('utf8');

    // Fallback for Uint8Array-like objects.
    const out = [];
    const len = Math.min(Number(buf.length) || 0, 65536);
    for (let i = 0; i < len; i++) out.push(String.fromCharCode(buf[i] & 0xff));
    return out.join('');
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
    if (!TcpSocket || typeof TcpSocket.createConnection !== 'function') throw new Error('react-native-tcp-socket.createConnection is required');
    if (typeof Buffer === 'undefined') throw new Error('global Buffer is required for SOCKS5 test');

    const hostBytes = Buffer.from(targetHost, 'utf8');
    if (hostBytes.length < 1 || hostBytes.length > 255) throw new Error('targetHost must be 1..255 bytes');

    return await new Promise((resolve, reject) => {
        let settled = false;
        let phase = 'greeting';
        let inBuf = Buffer.alloc(0);
        let httpBuf = Buffer.alloc(0);
        let timer = null;

        const fail = (e) => {
            if (settled) return;
            settled = true;
            try { if (timer) clearTimeout(timer); } catch (_e0) { }
            try { if (socket) socket.destroy(); } catch (_e1) { }
            reject(e);
        };

        const finish = (value) => {
            if (settled) return;
            settled = true;
            try { if (timer) clearTimeout(timer); } catch (_e0) { }
            try { if (socket) socket.destroy(); } catch (_e1) { }
            resolve(value);
        };

        timer = setTimeout(() => fail(new Error('SOCKS5 httpGet timeout')), timeoutMs);

        const socket = TcpSocket.createConnection({ host: socksHost, port: socksPort });
        socket.on('error', (e) => fail(new Error(`SOCKS5 socket error: ${e && e.message ? e.message : String(e)}`)));
        socket.on('close', () => {
            if (phase === 'http') {
                const text = httpBuf.toString('utf8');
                const firstLine = (text.split('\r\n')[0] || '').trim();
                const ok = /^HTTP\/[0-9.]+\s+200\b/.test(firstLine);
                finish({ ok, statusLine: firstLine, text });
                return;
            }
            if (!settled) fail(new Error(`SOCKS5 socket closed during phase=${phase}`));
        });

        socket.on('connect', () => {
            // Greeting: version 5, 1 method, no-auth.
            socket.write(Buffer.from([0x05, 0x01, 0x00]));
        });

        socket.on('data', (chunk) => {
            if (settled) return;
            inBuf = Buffer.concat([inBuf, chunk]);

            if (phase === 'greeting') {
                if (inBuf.length < 2) return;
                const v = inBuf[0];
                const method = inBuf[1];
                inBuf = inBuf.slice(2);
                if (v !== 0x05) return fail(new Error(`SOCKS5 bad version in greeting: ${String(v)}`));
                if (method !== 0x00) return fail(new Error(`SOCKS5 no-auth not accepted: ${String(method)}`));

                // CONNECT with domain name.
                const portHi = (targetPort >> 8) & 0xff;
                const portLo = targetPort & 0xff;
                const req = Buffer.concat([
                    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
                    hostBytes,
                    Buffer.from([portHi, portLo]),
                ]);
                phase = 'connect';
                socket.write(req);
            }

            if (phase === 'connect') {
                // Reply: VER, REP, RSV, ATYP, BND.ADDR..., BND.PORT...
                if (inBuf.length < 5) return;
                const ver = inBuf[0];
                const rep = inBuf[1];
                const atyp = inBuf[3];
                if (ver !== 0x05) return fail(new Error(`SOCKS5 bad version in reply: ${String(ver)}`));
                if (rep !== 0x00) return fail(new Error(`SOCKS5 connect failed rep=${String(rep)}`));

                // Consume variable length address.
                let addrLen = 0;
                let headerLen = 0;
                if (atyp === 0x01) { headerLen = 4 + 4 + 2; }
                else if (atyp === 0x04) { headerLen = 4 + 16 + 2; }
                else if (atyp === 0x03) {
                    if (inBuf.length < 5) return;
                    addrLen = inBuf[4];
                    headerLen = 4 + 1 + addrLen + 2;
                } else {
                    return fail(new Error(`SOCKS5 unknown ATYP=${String(atyp)}`));
                }
                if (inBuf.length < headerLen) return;
                inBuf = inBuf.slice(headerLen);

                phase = 'http';
                const reqText = `GET / HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`;
                socket.write(Buffer.from(reqText, 'utf8'));
            }

            if (phase === 'http') {
                httpBuf = Buffer.concat([httpBuf, inBuf]);
                inBuf = Buffer.alloc(0);
                if (httpBuf.length > maxBytes) return fail(new Error(`HTTP response exceeded maxBytes=${String(maxBytes)}`));
            }
        });
    });
}

async function sleepMsOrThrow(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0 || n > 5000) throw new Error('sleepMsOrThrow: ms must be 0..5000');
    return new Promise((resolve) => setTimeout(resolve, n));
}

async function waitForOrThrow(getter, label, maxAttempts, delayMs) {
    requireFunction(getter, 'getter');
    requireString(label, 'label');
    const attempts = Number(maxAttempts);
    const delay = Number(delayMs);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120) throw new Error('maxAttempts must be 1..120');
    if (!Number.isFinite(delay) || delay < 0 || delay > 2000) throw new Error('delayMs must be 0..2000');

    for (let i = 0; i < attempts; i++) {
        // eslint-disable-next-line no-await-in-loop
        const v = await getter();
        if (v) return v;
        // eslint-disable-next-line no-await-in-loop
        await sleepMsOrThrow(delay);
    }
    throw new Error(`timeout waiting for ${label}`);
}

async function waitForServiceOrThrow(name) {
    requireString(name, 'service name');

    const readyApp = await waitForOrThrow(
        async () => (app && app.services ? app : null),
        'rectify app',
        60,
        100,
    );

    const svc = await waitForOrThrow(
        async () => (readyApp.services && readyApp.services[name] ? readyApp.services[name] : null),
        `service:${name}`,
        60,
        100,
    );

    return svc;
}

function createTcpServerOrThrow() {
    // eslint-disable-next-line global-require
    const TcpSocket = require('react-native-tcp-socket');
    if (!TcpSocket || typeof TcpSocket.createServer !== 'function') throw new Error('react-native-tcp-socket.createServer is required');

    const server = TcpSocket.createServer((socket) => {
        let handled = false;
        const body = 'ok: rnTorHosting';
        const res = `HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`;

        const end = () => {
            try { socket.end(); } catch (e) {
                // eslint-disable-next-line no-console
                console.log('[rnTorHosting] socket.end error', e && e.message ? e.message : String(e));
            }
        };

        socket.on('error', (e) => {
            // eslint-disable-next-line no-console
            console.log('[rnTorHosting] socket error', e && e.message ? e.message : String(e));
        });

        socket.on('data', () => {
            if (handled) return;
            handled = true;
            try { socket.write(res); } catch (e) {
                // eslint-disable-next-line no-console
                console.log('[rnTorHosting] socket.write error', e && e.message ? e.message : String(e));
            }
            end();
        });
    });

    if (!server || typeof server.listen !== 'function') throw new Error('tcp server.listen is required');
    if (typeof server.close !== 'function') throw new Error('tcp server.close is required');
    return server;
}

async function listenOnFirstFreePortOrThrow(server, host, ports) {
    requireObject(server, 'server');
    requireString(host, 'host');
    if (!Array.isArray(ports) || ports.length < 1) throw new Error('ports must be a non-empty array');

    for (let i = 0; i < ports.length; i++) {
        const port = Number(ports[i]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1..65535');

        const started = await new Promise((resolve, reject) => {
            let settled = false;

            const onError = (e) => {
                if (settled) return;
                settled = true;
                try { server.removeListener('listening', onListening); } catch (_e2) { }
                reject(e);
            };

            const onListening = () => {
                if (settled) return;
                settled = true;
                try { server.removeListener('error', onError); } catch (_e2) { }
                resolve(true);
            };

            server.once('error', onError);
            server.once('listening', onListening);
            server.listen({ host, port });
        }).then(() => true, (e) => e);

        if (started === true) return port;

        const err = started;
        const code = err && err.code ? String(err.code) : '';
        if (code === 'EADDRINUSE') {
            // try next port
            continue;
        }
        const msg = err && err.message ? String(err.message) : String(err);
        throw new Error(`tcp listen failed on ${host}:${port}: ${msg}`);
    }

    throw new Error('no free port found in fixed port list');
}

const STATIC_BOOTSTRAP_KEY = {
    onion: 'gunkqyuamvuycqqjamtlupxkazmnbnq7avqn2eogc5fkxlpujj5bb5ad',
    seed_hex: 'f716a615bcca28bffede1ddaff734240e8e3e1f02156a3e4e2b8248f9894b348',
    pub_hex: '351aa8628065698142090326ba3eea0658d0b61f0560dd11c6174aabadf44a7a',
    generate: false,
};

export default {
    name: 'RnTorHosting',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: this suite is React-Native-only.
        if (isElectronRenderer()) return;
        if (!isReactNative()) return;

        h.describe('Tor: RN hidden service hosting', () => {
            h.it('starts tcp server, configures HS, reports .onion', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                requireFunction(assert.equal, 'assert.equal');
                if (typeof log !== 'function') throw new Error('log must be a function');

                const tor = await waitForServiceOrThrow('tor');
                requireObject(tor, 'tor service');
                requireFunction(tor.start, 'tor.start');
                requireFunction(tor.stop, 'tor.stop');
                requireFunction(tor.status, 'tor.status');
                requireObject(tor.hiddenServices, 'tor.hiddenServices');
                requireFunction(tor.hiddenServices.create, 'tor.hiddenServices.create');
                requireFunction(tor.hiddenServices.status, 'tor.hiddenServices.status');

                const server = createTcpServerOrThrow();
                let port = null;
                let torStarted = false;

                try {
                    log('starting local tcp server...');
                    port = await listenOnFirstFreePortOrThrow(server, '127.0.0.1', [9876, 9877, 9878, 9879, 9880, 9881, 9882, 9883, 9884, 9885]);
                    assert.ok(!!port, 'tcp server must have a port');

                    log('configuring hidden service...');
                    const created = await tor.hiddenServices.create({
                        port,
                        virtualPort: 80,
                        service: 'rn-tcp',
                        controlPort: true,
                        keys: [STATIC_BOOTSTRAP_KEY],
                    });
                    requireObject(created, 'hiddenServices.create result');
                    assert.ok(created.ok === true, 'hiddenServices.create must succeed');

                    log('starting tor...');
                    const started = await tor.start({ cleanSlate: false });
                    requireObject(started, 'tor.start result');
                    assert.ok(started.ok === true, 'tor.start must succeed');
                    torStarted = true;
                    requireString(started.onionAddress, 'tor.start onionAddress');
                    const onionServicePort = parseOnionPortOrThrow(started.onionAddress);

                    log('waiting for onion hostname...');
                    const hs = await waitForOrThrow(
                        async () => {
                            const st = await tor.hiddenServices.status();
                            if (!st || typeof st !== 'object' || st.ok !== true) return null;
                            if (!Array.isArray(st.results) || st.results.length < 1) return null;
                            const r0 = st.results[0];
                            if (!r0 || typeof r0 !== 'object') return null;
                            if (!r0.onion) return null;
                            return st;
                        },
                        'hidden service onion hostname',
                        60,
                        500,
                    );

                    requireObject(hs, 'hiddenServices.status result');
                    assert.equal(hs.service, 'rn-tcp', 'service name should be rn-tcp');
                    const onion = requireValidOnionHost(hs.results[0].onion);

                    log('fetching onion over Tor SOCKS5...');

                    const stAfter = await tor.status();
                    requireObject(stAfter, 'tor.status after start');
                    const socksPort = requirePositiveInt(stAfter.socksPort, 'tor.socksPort', 65535);

                    let last = null;
                    const http = await waitForOrThrow(
                        async () => {
                            const r = await socks5HttpGetOrThrow({
                                socksHost: '127.0.0.1',
                                socksPort,
                                targetHost: `${onion}.onion`,
                                targetPort: onionServicePort,
                                timeoutMs: 30000,
                                maxBytes: 128 * 1024,
                            });
                            last = r;
                            if (r && r.ok === true && typeof r.text === 'string' && r.text.includes('rnTorHosting')) return r;
                            return null;
                        },
                        'SOCKS5 http 200 with marker',
                        30,
                        500,
                    ).catch((e) => {
                        const details = last && typeof last === 'object'
                            ? `last.ok=${String(last.ok)} last.statusLine=${String(last.statusLine || '')}`
                            : 'last=<none>';
                        throw new Error(`${e && e.message ? e.message : String(e)} (${details})`);
                    });

                    requireObject(http, 'SOCKS5 http result');
                    assert.ok(http.ok === true, `expected HTTP 200, got: ${String(http.statusLine || '')}`);
                    assert.ok(String(http.text || '').includes('rnTorHosting'), 'response body must include marker');

                    log('ok', `${onion}.onion`);
                } catch (e) {
                    try {
                        if (torStarted) await tor.stop();
                    } catch (stopTorErr) {
                        // eslint-disable-next-line no-console
                        console.error('cleanup: tor.stop failed', stopTorErr);
                    }
                    try {
                        if (server) server.close();
                    } catch (closeErr) {
                        // eslint-disable-next-line no-console
                        console.error('cleanup: server.close failed', closeErr);
                    }
                    throw e;
                }

                if (torStarted) {
                    const stopped = await tor.stop();
                    requireObject(stopped, 'tor.stop result');
                    assert.ok(stopped.ok === true, 'tor.stop ok');
                }
                if (server) server.close();
            });
        });
    },
};
