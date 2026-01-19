import app from '../runtime/rectifyApp';
import { Linking } from 'react-native';

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

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requirePositiveInt(value, name, max) {
    const n = Number(value);
    const hi = Number(max);
    if (!Number.isInteger(n) || n <= 0 || n > hi) throw new Error(`${name} must be int 1..${hi}`);
    return n;
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
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 200) throw new Error('maxAttempts must be 1..200');
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

function parseExchangeDeepLinkOrNull(url) {
    if (!url) return null;
    const s = String(url).trim();
    if (!s) return null;
    // Expected format:
    // guncelium://e2e/torGunExchange/v1/<host>/<port>/<runId>
    if (!s.toLowerCase().startsWith('guncelium://')) return null;

    const withoutScheme = s.slice('guncelium://'.length);
    const parts = withoutScheme.split('/').filter(Boolean);
    if (parts.length !== 6) return null;

    const root = String(parts[0] || '').trim().toLowerCase();
    const kind = String(parts[1] || '').trim();
    const version = String(parts[2] || '').trim();
    const hostEnc = String(parts[3] || '').trim();
    const portStr = String(parts[4] || '').trim();
    const runEnc = String(parts[5] || '').trim();

    if (root !== 'e2e') return null;
    if (kind !== 'torGunExchange') return null;
    if (version !== 'v1') return null;

    const host = decodeURIComponent(hostEnc);
    const runId = decodeURIComponent(runEnc);
    return { host, portStr, runId };
}

function isDuoDeepLinkOrNull(url) {
    if (!url) return null;
    const s = String(url).trim();
    if (!s.toLowerCase().startsWith('guncelium://')) return null;
    const withoutScheme = s.slice('guncelium://'.length);
    const parts = withoutScheme.split('/').filter(Boolean);
    if (parts.length !== 3) return null;
    if (String(parts[0]).toLowerCase() !== 'e2e') return null;
    if (String(parts[1]) !== 'duo') return null;
    if (String(parts[2]) !== 'v1') return null;
    return { ok: true };
}

async function connectDuoCoordinatorOrThrow() {
    // eslint-disable-next-line global-require
    const { io } = require('socket.io-client');
    if (typeof io !== 'function') throw new Error('socket.io-client.io is required');

    const url = 'http://127.0.0.1:45820';

    return await new Promise((resolve, reject) => {
        let settled = false;
        const socket = io(url, {
            transports: ['websocket', 'polling'],
            timeout: 8000,
        });

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { socket.close(); } catch (_e) { }
            reject(new Error('duo coordinator connect timeout'));
        }, 8000);

        socket.on('connect', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(socket);
        });

        socket.on('connect_error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket.close(); } catch (_e) { }
            reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
}

function requireOnionHostnameWithSuffix(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!/^[a-z2-7]{56}\.onion$/.test(s)) throw new Error(`expected v3 onion hostname with .onion, got: ${s}`);
    return s;
}

function createTcpServerOrThrow() {
    // eslint-disable-next-line global-require
    const TcpSocket = require('react-native-tcp-socket');
    if (!TcpSocket || typeof TcpSocket.createServer !== 'function') throw new Error('react-native-tcp-socket.createServer is required');

    const server = TcpSocket.createServer((socket) => {
        try { socket.end(); } catch (_e) { }
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
        if (code === 'EADDRINUSE') continue;
        const msg = err && err.message ? String(err.message) : String(err);
        throw new Error(`tcp listen failed on ${host}:${String(port)}: ${msg}`);
    }

    throw new Error('no free port found in fixed port list');
}

export default {
    name: 'TorGunExchangeClient',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: client suite is React-Native-only.
        if (isElectronRenderer()) return;
        if (!isReactNative()) return;

        h.describe('Tor: exchange Gun data with Electron', () => {
            h.it('connects to Electron Tor HS and exchanges ping/pong', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                requireFunction(assert.equal, 'assert.equal');
                if (typeof log !== 'function') throw new Error('log must be a function');

                // In manual runs (no deep link), skip.
                const url = await waitForOrThrow(
                    async () => {
                        const u = await Linking.getInitialURL();
                        if (!u) return null;
                        const s = String(u).trim();
                        if (!s) return null;
                        return s;
                    },
                    'initial deep link url',
                    30,
                    200,
                ).catch(() => null);

                if (!url) return;
                const duo = isDuoDeepLinkOrNull(url);
                if (!duo) return;

                const gun = await waitForServiceOrThrow('gun');
                const tor = await waitForServiceOrThrow('tor');
                requireObject(gun, 'gun service');
                requireObject(tor, 'tor service');

                let tcpRunning = false;
                let torRunning = false;
                let server = null;

                let coord = null;
                let onionHost = null;
                let runId = null;
                const port = 8888;

                log('connecting to duo coordinator...');
                coord = await connectDuoCoordinatorOrThrow();

                let paramsResolve = null;
                const paramsPromise = new Promise((resolve) => {
                    paramsResolve = resolve;
                });
                if (typeof paramsResolve !== 'function') throw new Error('paramsPromise resolver missing');
                coord.on('exchangeParams', (p) => paramsResolve(p));

                const registerAck = await new Promise((resolve, reject) => {
                    coord.emit('register', { role: 'android' }, (ack) => {
                        if (!ack || ack.ok !== true) return reject(new Error(`duo register failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                        return resolve(ack);
                    });
                });

                if (registerAck && registerAck.exchangeParams) paramsResolve(registerAck.exchangeParams);

                log('waiting for exchange params from Electron...');
                const params = await Promise.race([
                    paramsPromise,
                    sleepMsOrThrow(120000).then(() => { throw new Error('timeout waiting for exchangeParams (duo)'); }),
                ]);

                requireObject(params, 'exchangeParams');
                onionHost = requireOnionHostnameWithSuffix(params.onionHost);
                assert.equal(Number(params.port), port, 'expected exchange port 8888');
                requireString(params.runId, 'runId');
                runId = String(params.runId).trim();

                const keyBase = `__e2e__/torGunExchange/${runId}`;
                const pingKey = `${keyBase}/ping`;
                const pongKey = `${keyBase}/pong`;
                const pingVal = { v: `ping-${runId}` };
                const pongExpected = `pong-${runId}`;

                try {
                    log('ensuring tor stopped...');
                    {
                        const pre = await tor.status();
                        requireObject(pre, 'tor.status (pre)');
                        if (pre.running === true) {
                            const stopped = await tor.stop();
                            requireObject(stopped, 'tor.stop (pre)');
                            assert.ok(stopped.ok === true, 'tor.stop (pre) ok');
                        }
                    }

                    // Start Tor using the hidden-service path to avoid flaky `initTorService` startup.
                    log('starting dummy tcp server (tor bootstrap)...');
                    server = createTcpServerOrThrow();
                    const dummyPort = await listenOnFirstFreePortOrThrow(server, '127.0.0.1', [9890, 9891, 9892, 9893, 9894, 9895, 9896, 9897, 9898, 9899]);
                    assert.ok(!!dummyPort, 'dummy tcp server must have a port');

                    log('configuring hidden service (tor bootstrap)...');
                    {
                        const created = await tor.hiddenServices.create({
                            port: dummyPort,
                            virtualPort: 80,
                            service: 'rn-xchg-bootstrap',
                            controlPort: true,
                            keys: [{ generate: true, maxAttempts: 1 }],
                        });
                        requireObject(created, 'hiddenServices.create');
                        assert.ok(created.ok === true, 'hiddenServices.create ok');
                    }

                    log('starting tor...');
                    {
                        const started = await tor.start({ cleanSlate: false, socksPort: 8765 });
                        requireObject(started, 'tor.start');
                        assert.ok(started.ok === true, 'tor.start ok');
                        torRunning = true;
                    }

                    log('waiting for tor running...');
                    await waitForOrThrow(
                        async () => {
                            const st = await tor.status();
                            if (!st || typeof st !== 'object' || st.ok !== true) return null;
                            if (st.running !== true) return null;
                            if (Number(st.socksPort) !== 8765) return null;
                            return st;
                        },
                        'tor.status running',
                        120,
                        250,
                    );

                    log('starting gun tcp client (over Tor SOCKS)...');
                    {
                        const peer = `tcp://${onionHost}:${String(port)}`;
                        const started = await gun.tcpStart({ port: 0, host: '127.0.0.1', peers: [peer], socksPort: 8765 });
                        requireObject(started, 'gun.tcpStart');
                        assert.ok(started.ok === true && started.running === true, 'gun tcp must be running');
                        tcpRunning = true;
                    }

                    log('signaling readiness to Electron (duo coordinator)...');
                    await new Promise((resolve, reject) => {
                        coord.emit('androidReady', { ok: true }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error('androidReady ack failed'));
                            return resolve();
                        });
                    });

                    log('sending ping...');
                    {
                        const put = await gun.tcpPut({ key: pingKey, value: pingVal, timeoutMs: 2000 });
                        requireObject(put, 'gun.tcpPut');
                        assert.ok(put.ok === true, 'gun.tcpPut ok');
                    }

                    log('waiting for pong...');
                    const got = await waitForOrThrow(
                        async () => {
                            const r = await gun.tcpOnce({ key: pongKey, timeoutMs: 500 });
                            if (!r || typeof r !== 'object' || r.ok !== true) return null;
                            const d = r.data;
                            if (!d || typeof d !== 'object') return null;
                            if (d.v !== pongExpected) return null;
                            return d;
                        },
                        'pong',
                        80,
                        250,
                    );
                    requireObject(got, 'pong data');
                    assert.equal(got.v, pongExpected, 'pong value must match');

                    log('ok', onionHost);
                } catch (e) {
                    try {
                        if (tcpRunning) await gun.tcpStop();
                    } catch (stopGunErr) {
                        // eslint-disable-next-line no-console
                        console.error('cleanup: gun.tcpStop failed', stopGunErr);
                    }
                    try {
                        if (torRunning) await tor.stop();
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
                    try {
                        if (coord) coord.close();
                    } catch (_e3) {
                        // ignore
                    }
                    throw e;
                }

                if (tcpRunning) {
                    const stopped = await gun.tcpStop();
                    requireObject(stopped, 'gun.tcpStop');
                    assert.ok(stopped.ok === true, 'gun.tcpStop ok');
                }
                if (torRunning) {
                    const stopped = await tor.stop();
                    requireObject(stopped, 'tor.stop');
                    assert.ok(stopped.ok === true, 'tor.stop ok');
                }
                if (server) server.close();
                if (coord) coord.close();
            });
        });
    },
};
