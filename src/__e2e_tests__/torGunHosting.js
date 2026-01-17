import app from '../runtime/rectifyApp';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function sleepMsOrThrow(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) throw new Error('sleepMsOrThrow: ms must be a non-negative number');
    return new Promise((resolve) => setTimeout(resolve, n));
}

async function waitForOrThrow(getter, label, maxAttempts, delayMs) {
    requireFunction(getter, 'getter');
    const attempts = Number(maxAttempts);
    const delay = Number(delayMs);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 200) throw new Error('maxAttempts must be 1..200');
    if (!Number.isFinite(delay) || delay < 0 || delay > 10000) throw new Error('delayMs must be 0..10000');

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
    if (typeof name !== 'string' || !name.trim()) throw new Error('service name must be a non-empty string');

    const readyApp = await waitForOrThrow(
        async () => (app && app.services ? app : null),
        'rectify app',
        50,
        100,
    );

    const svc = await waitForOrThrow(
        async () => (readyApp.services && readyApp.services[name] ? readyApp.services[name] : null),
        `service:${name}`,
        50,
        100,
    );

    return svc;
}

async function ensureTorInstalledOrThrow(tor) {
    const info = await tor.info();
    requireObject(info, 'tor.info');
    if (info.installed === true) return;

    const r = await tor.install({});
    requireObject(r, 'tor.install');
    if (r.ok !== true) throw new Error(`tor install failed: ${JSON.stringify(r)}`);
}

async function startTorOrThrow(tor) {
    const started = await tor.start({ cleanSlate: false });
    requireObject(started, 'tor.start');
    if (started.ok !== true) throw new Error(`tor start failed: ${JSON.stringify(started)}`);
    return started;
}

async function createHiddenServiceOrThrow(tor, gunPort) {
    const created = await tor.hiddenServices.create({
        // NOTE: createHiddenServices config is per-key entry; an empty list creates no HS.
        // Passing an empty object creates one HS dir and allows Tor to generate keys.
        keys: [{}],
        port: gunPort,
        virtualPort: 8888,
        service: 'gun-tcp',
        controlPort: true,
    });
    requireObject(created, 'tor.hiddenServices.create');
    if (created.ok !== true) throw new Error(`hidden service create failed: ${JSON.stringify(created)}`);
    return created;
}

async function waitForOnionOrThrow(tor) {
    const st = await waitForOrThrow(
        async () => {
            const s = await tor.hiddenServices.status();
            if (!s || typeof s !== 'object' || s.ok !== true) return null;
            if (!Array.isArray(s.results) || s.results.length < 1) return null;
            const r0 = s.results[0];
            if (!r0 || typeof r0 !== 'object') return null;
            if (!r0.onion) return null;
            return s;
        },
        'hidden service onion hostname',
        120,
        500,
    );

    const r0 = st.results[0];
    const onion = String(r0.onion);
    // Our Tor module returns the base32 hostname WITHOUT the `.onion` suffix.
    if (!/^[a-z2-7]{56}$/i.test(onion)) throw new Error(`expected v3 onion base32 hostname, got: ${onion}`);
    return st;
}

export default {
    name: 'TorGunHosting',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        h.describe('Tor: host Gun TCP as hidden service', () => {
            h.it('starts gun tcp, starts tor, creates HS, reports .onion', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                requireFunction(assert.equal, 'assert.equal');
                if (typeof log !== 'function') throw new Error('log must be a function');

                const isElectron = typeof window === 'object' && window && window.ElectronNative;
                assert.ok(!!isElectron, 'must run in electron renderer (ElectronNative missing)');

                const gun = await waitForServiceOrThrow('gun');
                const tor = await waitForServiceOrThrow('tor');
                requireObject(gun, 'gun service');
                requireObject(tor, 'tor service');

                let gunStarted = null;
                let torStarted = false;

                try {
                    log('starting gun tcp...');
                    gunStarted = await gun.tcpStart({ host: '127.0.0.1', port: 0, peers: [] });
                    requireObject(gunStarted, 'gun.tcpStart result');
                    assert.ok(gunStarted.ok === true && gunStarted.running === true, 'gun tcp must be running');
                    assert.ok(!!gunStarted.port, 'gun tcp must have a port');

                    log('ensuring tor installed...');
                    await ensureTorInstalledOrThrow(tor);

                    log('ensuring tor is stopped...');
                    const preInfo = await tor.info();
                    requireObject(preInfo, 'tor.info (pre)');
                    if (preInfo.running === true) {
                        const preStopped = await tor.stop();
                        requireObject(preStopped, 'tor.stop (pre)');
                        assert.ok(preStopped.ok === true, 'tor.stop (pre) ok');
                    }

                    log('creating hidden service config...');
                    await createHiddenServiceOrThrow(tor, gunStarted.port);

                    log('starting tor...');
                    await startTorOrThrow(tor);
                    torStarted = true;

                    log('waiting for onion hostname...');
                    const hsStatus = await waitForOnionOrThrow(tor);
                    requireObject(hsStatus, 'hsStatus');
                    assert.equal(hsStatus.service, 'gun-tcp', 'service name should be gun-tcp');

                    log('ok', `${hsStatus.results[0].onion}.onion`);
                } catch (e) {
                    // cleanup (do not swallow failures; rethrow original error)
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

                // normal cleanup
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
