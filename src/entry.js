import app from './runtime/rectifyApp';

// Keep Expo/RN UI bootstrap.
import './init';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requirePromiseLike(value, name) {
    if (!value || typeof value.then !== 'function') throw new Error(`${name} must be a Promise`);
}

function waitForReadyOrThrow(targetApp, timeoutMs) {
    requireObject(targetApp, 'app');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs must be a positive integer');

    return new Promise((resolve, reject) => {
        let done = false;

        const onReady = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
        };

        const onError = (e) => {
            if (done) return;
            done = true;
            cleanup();
            reject(e);
        };

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            reject(new Error(`rectify app did not emit 'ready' within ${timeoutMs}ms`));
        }, timeoutMs);

        function cleanup() {
            clearTimeout(timer);
            targetApp.removeListener('ready', onReady);
            targetApp.removeListener('error', onError);
        }

        targetApp.once('ready', onReady);
        targetApp.once('error', onError);
    });
}

async function bootOrThrow() {
    requireObject(app, 'rectify app');

    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    const hasDom = (typeof window === 'object' && typeof window.document !== 'undefined');
    const isElectronRenderer = !!(hasDom && root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');

    const REQUIRED = isElectronRenderer ? ['gun', 'tor', 'moniker'] : ['gun', 'moniker'];
    const BOOT_TIMEOUT_MS = 15_000;

    app.on('service', (name) => {
        try { console.log(`[entry] service ready: ${String(name)}`); } catch (_e) { }
    });
    app.on('plugin', (plugin) => {
        try {
            const provides = (plugin && Array.isArray(plugin.provides)) ? plugin.provides.join(',') : 'unknown';
            console.log(`[entry] plugin loaded provides=[${provides}]`);
        } catch (_e) { }
    });

    app.on('error', (e) => {
        try { console.error('[entry] rectify error', e && (e.stack || e.message) ? (e.stack || e.message) : String(e)); } catch (_e) { }
    });

    console.log('[entry] starting rectify...');
    const readyPromise = waitForReadyOrThrow(app, BOOT_TIMEOUT_MS);
    const startPromise = app.start('entry');
    requirePromiseLike(startPromise, 'app.start');

    await readyPromise;

    requireObject(app.services, 'app.services');
    const missing = [];
    for (let i = 0; i < REQUIRED.length; i++) {
        const name = REQUIRED[i];
        if (!app.services[name]) missing.push(name);
    }
    if (missing.length) {
        const available = Object.keys(app.services).join(',');
        throw new Error(`missing required services: ${missing.join(', ')} (available: ${available})`);
    }

    console.log('[entry] rectify ready');
}

bootOrThrow().catch((e) => {
    try { console.error('[entry] boot failed', e && (e.stack || e.message) ? (e.stack || e.message) : String(e)); } catch (_e) { }
    throw e;
});

export default app;
