import app from '../runtime/rectifyApp';

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
        service: 'proto-xchg',
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

function requireProtocalElectronApiOrThrow() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : null;
    if (!root || typeof root !== 'object') throw new Error('globalThis missing');
    const en = root.ElectronNative;
    if (!en || typeof en !== 'object') throw new Error('ElectronNative missing');
    const api = en['guncelium-protocal'];
    if (!api || typeof api !== 'object' || api._missing) throw new Error('ElectronNative[guncelium-protocal] missing');
    requireFunction(api.serverStart, 'protocal.serverStart');
    requireFunction(api.serverWaitPing, 'protocal.serverWaitPing');
    requireFunction(api.serverStop, 'protocal.serverStop');
    return api;
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
    name: 'TorProtoExchangeHost',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: host suite is Electron-renderer-only.
        if (!isElectronRenderer()) {
            if (isReactNative()) return;
        }

        h.describe('Tor: exchange protocol frames with Android', () => {
            h.it('hosts HS and completes ping/pong over framed protocol', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                if (typeof log !== 'function') throw new Error('log must be a function');

                const tor = await waitForServiceOrThrow('tor');
                requireObject(tor, 'tor service');

                const protocal = requireProtocalElectronApiOrThrow();

                await ensureTorInstalledOrThrow(tor);
                await ensureTorStoppedOrThrow(assert, tor);

                const runId = String(Date.now());
                const serverPeerId = `a-electron-${runId}`;

                let server = null;
                let serverId = null;
                let torStarted = false;
                let coord = null;

                try {
                    log('starting local tcp server...');
                    const startedServer = await protocal.serverStart({ peerId: serverPeerId, helloTimeoutMs: 5000 });
                    requireObject(startedServer, 'protocal.serverStart');
                    if (startedServer.ok !== true) throw new Error(`protocal.serverStart failed: ${JSON.stringify(startedServer)}`);
                    requireString(startedServer.serverId, 'serverId');
                    serverId = String(startedServer.serverId);
                    const localPort = Number(startedServer.port);
                    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) throw new Error('protocal.serverStart port invalid');
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

                    log('publishing exchange params to duo coordinator...');
                    coord = await connectDuoCoordinatorOrThrow();

                    await new Promise((resolve, reject) => {
                        coord.emit('register', { role: 'electron' }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duo register failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            return resolve();
                        });
                    });

                    await new Promise((resolve, reject) => {
                        coord.emit('exchangeParams', { onionHost: `${onionBase}.onion`, port: 8888, runId }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duo exchangeParams failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            return resolve();
                        });
                    });

                    log('waiting for Android ping over Tor...');
                    const waited = await protocal.serverWaitPing({ serverId, timeoutMs: 120000 });
                    requireObject(waited, 'protocal.serverWaitPing');
                    if (waited.ok !== true) throw new Error(`protocal.serverWaitPing failed: ${JSON.stringify(waited)}`);

                    log('ok', `${onionBase}.onion`);
                } finally {
                    try { if (coord) coord.close(); } catch (_e3) { }
                    try { if (serverId) await protocal.serverStop({ serverId }); } catch (_e4) { }
                    if (torStarted) {
                        const stopped = await tor.stop();
                        requireObject(stopped, 'tor.stop');
                        assert.ok(stopped.ok === true, 'tor.stop ok');
                    }
                }

                assert.ok(true, 'Tor protocol exchange host ok');
            });
        });
    },
};
