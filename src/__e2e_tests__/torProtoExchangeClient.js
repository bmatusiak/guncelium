import app from '../runtime/rectifyApp';
import { Linking } from 'react-native';

// eslint-disable-next-line global-require
const { createSocketAdapterOrThrow } = require('guncelium-protocal');

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
    if (!Number.isInteger(delay) || delay < 0 || delay > 2000) throw new Error('delayMs must be 0..2000');

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

function requireOnionHostnameWithSuffix(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!/^[a-z2-7]{56}\.onion$/.test(s)) throw new Error(`expected v3 onion hostname with .onion, got: ${s}`);
    return s;
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

export default {
    name: 'TorProtoExchangeClient',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: client suite is React-Native-only.
        if (isElectronRenderer()) return;
        if (!isReactNative()) return;

        h.describe('Tor: exchange protocol frames with Electron', () => {
            h.it('connects to Electron HS over Tor and completes ping/pong', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                requireFunction(assert.equal, 'assert.equal');
                if (typeof log !== 'function') throw new Error('log must be a function');

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

                const tor = await waitForServiceOrThrow('tor');
                requireObject(tor, 'tor service');

                const expectedSocksPort = 8765;

                let coord = null;
                let onionHost = null;
                let runId = null;
                const port = 8888;

                log('connecting to duo coordinator...');
                coord = await connectDuoCoordinatorOrThrow();

                let paramsResolve = null;
                const paramsPromise = new Promise((resolve) => { paramsResolve = resolve; });
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

                const clientPeerId = `z-android-${runId}`;

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

                    log('starting tor...');
                    const started = await tor.start({ cleanSlate: false, socksPort: expectedSocksPort });
                    requireObject(started, 'tor.start');
                    assert.ok(started.ok === true, 'tor.start ok');

                    log('waiting for tor running...');
                    await waitForOrThrow(
                        async () => {
                            const st = await tor.status();
                            if (!st || typeof st !== 'object' || st.ok !== true) return null;
                            if (st.running !== true) return null;
                            if (Number(st.socksPort) !== expectedSocksPort) return null;
                            return st;
                        },
                        'tor.status running',
                        200,
                        250,
                    );

                    log('connecting to onion over Tor SOCKS (framed protocol)...');
                    // eslint-disable-next-line global-require
                    const TcpSocket = require('react-native-tcp-socket');
                    requireObject(TcpSocket, 'TcpSocket');

                    const clientAdapter = createSocketAdapterOrThrow(TcpSocket, {
                        socksHost: '127.0.0.1',
                        socksPort: expectedSocksPort,
                        handshakeTimeoutMs: 60000,
                        enableHello: true,
                        peerId: clientPeerId,
                        helloTimeoutMs: 5000,
                    });

                    const sock = await clientAdapter.connect(onionHost, port);
                    requireObject(sock, 'proto socket');
                    requireFunction(sock.send, 'sock.send');
                    requireFunction(sock.close, 'sock.close');

                    let gotPong = false;
                    sock.onmessage = (ev) => {
                        const d = ev && ev.data !== undefined ? ev.data : null;
                        if (typeof d === 'string' && d === 'pong') gotPong = true;
                    };

                    sock.send('ping');
                    await waitForOrThrow(async () => (gotPong === true ? true : null), 'pong', 160, 250);

                    try { sock.close(); } catch (_e) { }

                    log('ok', onionHost);
                } finally {
                    try { if (coord) coord.close(); } catch (_e2) { }
                }

                assert.ok(true, 'Tor protocol exchange client ok');
            });
        });
    },
};
