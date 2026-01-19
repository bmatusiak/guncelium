import app from '../runtime/rectifyApp';

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

function requireV3OnionHostname(value, name) {
    const s = String(value || '').trim();
    if (!/^[a-z2-7]{56}$/i.test(s)) throw new Error(`${name} must be a v3 onion base32 hostname (no .onion), got: ${s}`);
    return s;
}

async function ensureTorInstalledOrThrow(tor) {
    const info = await tor.info();
    requireObject(info, 'tor.info');
    if (info.installed === true) return;

    const r = await tor.install({});
    requireObject(r, 'tor.install');
    if (r.ok !== true) throw new Error(`tor install failed: ${JSON.stringify(r)}`);
}

async function ensureTorStoppedOrThrow(assert, tor) {
    requireObject(assert, 'assert');
    requireFunction(assert.ok, 'assert.ok');

    const st = await tor.info();
    requireObject(st, 'tor.info');
    if (st.running === true) {
        const stopped = await tor.stop();
        requireObject(stopped, 'tor.stop');
        assert.ok(stopped.ok === true, 'tor.stop ok');
    }
}

async function startTorOrThrow(tor) {
    const started = await tor.start({ cleanSlate: false });
    requireObject(started, 'tor.start');
    if (started.ok !== true) throw new Error(`tor start failed: ${JSON.stringify(started)}`);
    return started;
}

async function createHiddenServiceOrThrow(tor, localPort, keys) {
    requireObject(tor, 'tor');
    requireObject(tor.hiddenServices, 'tor.hiddenServices');
    requireFunction(tor.hiddenServices.create, 'tor.hiddenServices.create');
    if (!Array.isArray(keys) || keys.length < 1) throw new Error('keys must be a non-empty array');

    const created = await tor.hiddenServices.create({
        keys,
        port: localPort,
        virtualPort: 8888,
        service: 'proto-self',
        controlPort: true,
    });
    requireObject(created, 'tor.hiddenServices.create');
    if (created.ok !== true) throw new Error(`hidden service create failed: ${JSON.stringify(created)}`);
    return created;
}

function pickGeneratedKeyResultOrThrow(createResult) {
    requireObject(createResult, 'createResult');
    if (!Array.isArray(createResult.results) || createResult.results.length < 1) throw new Error('hidden service create returned no results');

    for (let i = 0; i < createResult.results.length; i++) {
        const r = createResult.results[i];
        if (!r || typeof r !== 'object') continue;
        const k = r.key;
        if (!k || typeof k !== 'object') continue;
        if (k.generate === true && r.ok === true && r.onion_expected) return r;
    }

    throw new Error('failed to locate generated key result (expected key.generate=true and onion_expected)');
}

async function waitForOnionOrThrow(tor, expectedOnion) {
    const want = requireV3OnionHostname(expectedOnion, 'expectedOnion');
    return await waitForOrThrow(
        async () => {
            const s = await tor.hiddenServices.status();
            if (!s || typeof s !== 'object' || s.ok !== true) return null;
            if (!Array.isArray(s.results) || s.results.length < 1) return null;
            for (let i = 0; i < s.results.length; i++) {
                const r = s.results[i];
                if (!r || typeof r !== 'object') continue;
                if (r.onion && String(r.onion).toLowerCase() === String(want).toLowerCase()) return s;
            }
            return null;
        },
        'hidden service onion hostname (expected)',
        120,
        500,
    );
}

async function getServerPortOrThrow(server) {
    requireObject(server, 'server');
    requireFunction(server.address, 'server.address');

    return await waitForOrThrow(
        async () => {
            const a = server.address();
            if (!a || typeof a !== 'object') return null;
            const p = Number(a.port);
            if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
            return p;
        },
        'server.address().port',
        60,
        50,
    );
}

export default {
    name: 'TorProtoHosting',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: Electron-only.
        if (!isElectronRenderer()) {
            if (isReactNative()) return;
        }

        h.describe('Tor: protocol connect-ability (Electron self)', () => {
            h.it('hosts HS and connects via SOCKS + framed protocol', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                requireFunction(assert.equal, 'assert.equal');
                if (typeof log !== 'function') throw new Error('log must be a function');

                // eslint-disable-next-line global-require
                const net = require('net');
                requireObject(net, 'net');

                const tor = await waitForServiceOrThrow('tor');
                requireObject(tor, 'tor service');

                await ensureTorInstalledOrThrow(tor);
                await ensureTorStoppedOrThrow(assert, tor);

                // Server side: framed protocol listener (no Gun).
                const runId = String(Date.now());
                const serverPeerId = `a-electron-${runId}`;
                const serverAdapter = createSocketAdapterOrThrow(net, {
                    enableHello: true,
                    peerId: serverPeerId,
                    helloTimeoutMs: 5000,
                });

                let gotPing = false;
                let server = null;
                let torStarted = false;

                try {
                    server = serverAdapter.listen(0, (peer) => {
                        try {
                            peer.onmessage = (ev) => {
                                const d = ev && ev.data !== undefined ? ev.data : null;
                                if (typeof d === 'string' && d === 'ping') {
                                    gotPing = true;
                                    peer.send('pong');
                                }
                            };
                        } catch (_e) {
                            try { peer.close(); } catch (_e2) { }
                        }
                    }, '127.0.0.1');

                    const localPort = await getServerPortOrThrow(server);
                    assert.ok(localPort > 0, 'server must bind');

                    log('creating hidden service config...');
                    const created = await createHiddenServiceOrThrow(tor, localPort, [{ generate: true, maxAttempts: 1 }]);
                    const gen = pickGeneratedKeyResultOrThrow(created);
                    const onionBase = requireV3OnionHostname(gen.onion_expected, 'onion');

                    log('starting tor...');
                    await startTorOrThrow(tor);
                    torStarted = true;

                    log('waiting for onion hostname...');
                    await waitForOnionOrThrow(tor, onionBase);

                    log('connecting to onion via SOCKS (self)...');
                    const st = await tor.status();
                    requireObject(st, 'tor.status');
                    const socksPort = Number(st.socksPort);
                    assert.ok(Number.isInteger(socksPort) && socksPort > 0 && socksPort <= 65535, 'tor.status.socksPort must be valid');

                    const clientPeerId = `z-client-${runId}`;
                    const clientAdapter = createSocketAdapterOrThrow(net, {
                        socksHost: '127.0.0.1',
                        socksPort,
                        handshakeTimeoutMs: 60000,
                        enableHello: true,
                        peerId: clientPeerId,
                        helloTimeoutMs: 5000,
                    });

                    const client = await clientAdapter.connect(`${onionBase}.onion`, 8888);
                    requireObject(client, 'client');
                    requireFunction(client.send, 'client.send');
                    requireFunction(client.close, 'client.close');

                    let gotPong = false;
                    client.onmessage = (ev) => {
                        const d = ev && ev.data !== undefined ? ev.data : null;
                        if (typeof d === 'string' && d === 'pong') gotPong = true;
                    };

                    client.send('ping');

                    await waitForOrThrow(async () => (gotPing === true ? true : null), 'server got ping', 80, 100);
                    await waitForOrThrow(async () => (gotPong === true ? true : null), 'client got pong', 80, 100);

                    try { client.close(); } catch (_e) { }
                } finally {
                    try { if (server) server.close(); } catch (_e2) { }
                    if (torStarted) {
                        const stopped = await tor.stop();
                        requireObject(stopped, 'tor.stop');
                        assert.ok(stopped.ok === true, 'tor.stop ok');
                    }
                }

                assert.ok(true, 'Tor protocol self-connect ok');
            });
        });
    },
};
