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

function requireV3OnionHostname(value, name) {
    const s = String(value || '').trim();
    if (!/^[a-z2-7]{56}$/i.test(s)) throw new Error(`${name} must be a v3 onion base32 hostname (no .onion), got: ${s}`);
    return s;
}

function requireUint8Array(value, name) {
    if (!(value instanceof Uint8Array)) throw new Error(`${name} must be a Uint8Array`);
}

function randomHexSuffixOrThrow() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    requireObject(root, 'globalThis');
    requireObject(root.crypto, 'crypto');
    requireFunction(root.crypto.getRandomValues, 'crypto.getRandomValues');
    const buf = new Uint8Array(8);
    root.crypto.getRandomValues(buf);
    requireUint8Array(buf, 'random buf');

    let out = '';
    for (let i = 0; i < buf.length; i++) {
        out += buf[i].toString(16).padStart(2, '0');
    }
    return out;
}

async function getElectronTempDirOrThrow() {
    if (typeof window !== 'object' || !window) throw new Error('window is required');
    const electron = window.electron;
    requireObject(electron, 'window.electron');
    requireFunction(electron.getPath, 'window.electron.getPath');
    const p = await electron.getPath('temp');
    requireString(p, 'electron.getPath(temp)');
    return p;
}

function joinPathOrThrow(base, leaf) {
    requireString(base, 'base');
    requireString(leaf, 'leaf');
    const sep = base.endsWith('/') ? '' : '/';
    return `${base}${sep}${leaf}`;
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

async function createHiddenServiceOrThrow(tor, gunPort, keys) {
    requireObject(tor, 'tor');
    requireObject(tor.hiddenServices, 'tor.hiddenServices');
    requireFunction(tor.hiddenServices.create, 'tor.hiddenServices.create');
    if (!Array.isArray(keys) || keys.length < 1) throw new Error('keys must be a non-empty array');

    const created = await tor.hiddenServices.create({
        keys,
        port: gunPort,
        virtualPort: 8888,
        service: 'gun-xchg',
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
        if (k.generate === true && r.ok === true && r.onion_expected) {
            return r;
        }
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

function buildAndroidLaunchUrlOrThrow(onionHostNoSuffix, runId) {
    const onion = requireV3OnionHostname(onionHostNoSuffix, 'onion');
    requireString(runId, 'runId');
    const host = `${onion}.onion`;
    // IMPORTANT: keep this URL free of '&' so `adb shell am start -d <url>` is deterministic.
    // Format: guncelium://e2e/torGunExchange/v1/<host>/<port>/<runId>
    const encHost = encodeURIComponent(host);
    const encRun = encodeURIComponent(runId);
    return `guncelium://e2e/torGunExchange/v1/${encHost}/8888/${encRun}`;
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
    name: 'TorGunExchangeHost',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: host suite is Electron-renderer-only.
        if (!isElectronRenderer()) {
            if (isReactNative()) return;
        }

        h.describe('Tor: exchange Gun data with Android', () => {
            h.it('hosts Gun TCP over Tor and exchanges ping/pong', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                requireFunction(assert.equal, 'assert.equal');
                if (typeof log !== 'function') throw new Error('log must be a function');

                const gun = await waitForServiceOrThrow('gun');
                const tor = await waitForServiceOrThrow('tor');
                requireObject(gun, 'gun service');
                requireObject(tor, 'tor service');

                let gunStarted = null;
                let torStarted = false;

                const runId = `${Date.now()}-${randomHexSuffixOrThrow()}`;
                const keyBase = `__e2e__/torGunExchange/${runId}`;
                const pingKey = `${keyBase}/ping`;
                const pongKey = `${keyBase}/pong`;
                const pingVal = { v: `ping-${runId}` };
                const pongVal = { v: `pong-${runId}` };

                try {
                    const tempDir = await getElectronTempDirOrThrow();
                    const tcpStoreDir = joinPathOrThrow(tempDir, `guncelium-e2e-gun-xchg-${runId}`);

                    log('starting gun tcp (reserve port)...');
                    gunStarted = await gun.tcpStart({ host: '127.0.0.1', port: 0, peers: [], storeDir: tcpStoreDir });
                    requireObject(gunStarted, 'gun.tcpStart result');
                    assert.ok(gunStarted.ok === true && gunStarted.running === true, 'gun tcp must be running');
                    const reservedPort = Number(gunStarted.port);
                    assert.ok(Number.isInteger(reservedPort) && reservedPort > 0 && reservedPort <= 65535, 'reservedPort must be valid');

                    log('stopping gun tcp (reserve port only)...');
                    {
                        const stopped = await gun.tcpStop();
                        requireObject(stopped, 'gun.tcpStop (reserve) result');
                        assert.ok(stopped.ok === true, 'gun.tcpStop (reserve) ok');
                    }
                    gunStarted = null;

                    log('ensuring tor installed...');
                    await ensureTorInstalledOrThrow(tor);

                    log('ensuring tor stopped...');
                    await ensureTorStoppedOrThrow(assert, tor);

                    log('creating hidden service config...');
                    const created = await createHiddenServiceOrThrow(tor, reservedPort, [{ generate: true, maxAttempts: 1 }]);
                    const gen = pickGeneratedKeyResultOrThrow(created);
                    const peerId = requireV3OnionHostname(gen.onion_expected, 'peerId');

                    log('starting gun tcp with peerId (fixed port)...');
                    gunStarted = await gun.tcpStart({ host: '127.0.0.1', port: reservedPort, peerId, peers: [], storeDir: tcpStoreDir });
                    requireObject(gunStarted, 'gun.tcpStart (peerId) result');
                    assert.ok(gunStarted.ok === true && gunStarted.running === true, 'gun tcp must be running');
                    assert.equal(Number(gunStarted.port), reservedPort, 'gun tcp must bind reserved port');

                    log('starting tor...');
                    await startTorOrThrow(tor);
                    torStarted = true;

                    log('waiting for onion hostname...');
                    await waitForOnionOrThrow(tor, peerId);

                    log('publishing exchange params to duo coordinator...');
                    const coord = await connectDuoCoordinatorOrThrow();
                    await new Promise((resolve, reject) => {
                        coord.emit('register', { role: 'electron' }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duo register failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            return resolve();
                        });
                    });
                    await new Promise((resolve, reject) => {
                        coord.emit('exchangeParams', { onionHost: `${peerId}.onion`, port: 8888, runId }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duo exchangeParams failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            return resolve();
                        });
                    });

                    log('waiting for Android readiness via duo coordinator...');
                    await new Promise((resolve, reject) => {
                        let done = false;
                        const timer = setTimeout(() => {
                            if (done) return;
                            done = true;
                            try { coord.close(); } catch (_e) { }
                            reject(new Error('timeout waiting for androidReady (duo)'));
                        }, 60000);

                        coord.on('androidReady', () => {
                            if (done) return;
                            done = true;
                            clearTimeout(timer);
                            try { coord.close(); } catch (_e) { }
                            resolve();
                        });
                    });

                    log('waiting for Android ping over Tor...');
                    await waitForOrThrow(
                        async () => {
                            const r = await gun.tcpOnce({ key: pingKey, timeoutMs: 500 });
                            if (!r || typeof r !== 'object' || r.ok !== true) return null;
                            const d = r.data;
                            if (!d || typeof d !== 'object') return null;
                            if (d.v !== pingVal.v) return null;
                            return d;
                        },
                        'android ping',
                        160,
                        250,
                    );

                    log('writing pong to Android over Tor...');
                    {
                        const put = await gun.tcpPut({ key: pongKey, value: pongVal, timeoutMs: 2000 });
                        requireObject(put, 'gun.tcpPut result');
                        assert.ok(put.ok === true, 'gun.tcpPut ok');
                    }

                    log('ok', `${peerId}.onion`);
                } catch (e) {
                    try {
                        if (torStarted) await tor.stop();
                    } catch (stopTorErr) {
                        // eslint-disable-next-line no-console
                        console.error('cleanup: tor.stop failed', stopTorErr);
                    }
                    try {
                        if (gunStarted && gunStarted.running) await gun.tcpStop();
                    } catch (stopGunErr) {
                        // eslint-disable-next-line no-console
                        console.error('cleanup: gun.tcpStop failed', stopGunErr);
                    }
                    throw e;
                }

                if (torStarted) {
                    const stopped = await tor.stop();
                    requireObject(stopped, 'tor.stop result');
                    assert.ok(stopped.ok === true, 'tor.stop ok');
                }
                if (gunStarted && gunStarted.running) {
                    const stopped = await gun.tcpStop();
                    requireObject(stopped, 'gun.tcpStop result');
                    assert.ok(stopped.ok === true, 'gun.tcpStop ok');
                }
            });
        });
    },
};
