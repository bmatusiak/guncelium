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
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120) throw new Error('maxAttempts must be 1..120');
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

    return await waitForOrThrow(
        async () => (readyApp.services && readyApp.services[name] ? readyApp.services[name] : null),
        `service:${name}`,
        60,
        100,
    );
}

function requireGunInstanceOrThrow(gun) {
    const t = typeof gun;
    if (!gun || (t !== 'function' && t !== 'object')) throw new Error('gun instance must be an object or function');
    if (typeof gun.get !== 'function') throw new Error('gun.get must be a function');
    return gun;
}

async function gunOnceValueOrThrow(gun, key, timeoutMs) {
    requireGunInstanceOrThrow(gun);
    requireString(key, 'key');
    const ms = Number(timeoutMs);
    if (!Number.isInteger(ms) || ms < 50 || ms > 10000) throw new Error('timeoutMs must be 50..10000');

    return await new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('timeout waiting for gun.once'));
        }, ms);

        gun.get(key).once((v) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(v);
        });
    });
}

export default {
    name: 'GunLocalElectron',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: this suite is Electron-renderer-only.
        if (!isElectronRenderer()) {
            if (isReactNative()) return;
            return;
        }

        h.describe('Gun: local-first (Electron)', () => {
            h.it('starts local gun, connects via gunClient, put/once works', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                if (typeof log !== 'function') throw new Error('log must be a function');

                const gun = await waitForServiceOrThrow('gun');
                const gunClient = await waitForServiceOrThrow('gunClient');

                requireObject(gun, 'gun service');
                requireFunction(gun.status, 'gun.status');
                requireFunction(gun.start, 'gun.start');
                requireFunction(gun.stop, 'gun.stop');

                requireObject(gunClient, 'gunClient service');
                requireFunction(gunClient.connect, 'gunClient.connect');
                requireFunction(gunClient.disconnect, 'gunClient.disconnect');
                requireFunction(gunClient.get, 'gunClient.get');
                requireFunction(gunClient.status, 'gunClient.status');

                const key = `gun-local-electron-${Date.now()}`;
                const expected = { ok: true, v: `hello-${Date.now()}` };

                let serverStarted = false;
                let clientConnected = false;

                const cleanupErrors = [];
                let testError = null;

                try {
                    const st0 = await gun.status();
                    requireObject(st0, 'gun.status');
                    assert.ok(st0.ok === true, 'gun.status.ok must be true');
                    if (st0.running === true) {
                        log('stopping existing gun server...');
                        const stopped = await gun.stop();
                        requireObject(stopped, 'gun.stop');
                        assert.ok(stopped.ok === true, 'gun.stop ok');
                    }

                    log('starting gun server...');
                    const started = await gun.start({ port: 0, peers: [] });
                    requireObject(started, 'gun.start');
                    assert.ok(started.ok === true, 'gun.start ok');
                    serverStarted = true;

                    log('connecting gun client...');
                    const cs = await gunClient.connect();
                    requireObject(cs, 'gunClient.connect');
                    assert.ok(cs.ok === true, 'gunClient.connect ok');
                    clientConnected = true;

                    const clientGun = requireGunInstanceOrThrow(gunClient.get());

                    clientGun.get(key).put(expected);

                    const got = await gunOnceValueOrThrow(clientGun, key, 5000);
                    requireObject(got, 'gun.once value');
                    assert.ok(got.ok === true, 'readback ok must be true');
                    assert.ok(String(got.v) === String(expected.v), 'readback v must match');

                    log('ok', JSON.stringify({ key, got }));
                } catch (e) {
                    testError = e;
                } finally {
                    if (clientConnected) {
                        try {
                            await gunClient.disconnect();
                        } catch (e) {
                            cleanupErrors.push(new Error(`cleanup: gunClient.disconnect failed: ${String(e)}`));
                        }
                    }
                    if (serverStarted) {
                        try {
                            await gun.stop();
                        } catch (e) {
                            cleanupErrors.push(new Error(`cleanup: gun.stop failed: ${String(e)}`));
                        }
                    }
                }

                if (cleanupErrors.length > 0) {
                    if (testError) throw new AggregateError([testError, ...cleanupErrors], 'test and cleanup failures');
                    throw cleanupErrors[0];
                }
                if (testError) throw testError;
            });
        });
    },
};
