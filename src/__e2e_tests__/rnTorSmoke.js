import app from '../runtime/rectifyApp';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
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

async function sleepMsOrThrow(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0 || n > 5000) throw new Error('sleepMsOrThrow: ms must be 0..5000');
    return new Promise((resolve) => setTimeout(resolve, n));
}

async function waitForOrThrow(getter, label, maxAttempts, delayMs) {
    requireFunction(getter, 'getter');
    const attempts = Number(maxAttempts);
    const delay = Number(delayMs);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) throw new Error('maxAttempts must be 1..60');
    if (!Number.isFinite(delay) || delay < 0 || delay > 1000) throw new Error('delayMs must be 0..1000');
    if (typeof label !== 'string' || !label.trim()) throw new Error('label must be a non-empty string');

    for (let i = 0; i < attempts; i++) {
        // eslint-disable-next-line no-await-in-loop
        const v = await getter();
        if (v) return v;
        // eslint-disable-next-line no-await-in-loop
        await sleepMsOrThrow(delay);
    }
    throw new Error(`timeout waiting for ${label}`);
}

export default {
    name: 'RnTorSmoke',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // True skip: this suite is React-Native-only.
        if (isElectronRenderer()) return;
        if (!isReactNative()) return;

        h.describe('Tor: RN smoke', () => {
            h.it('exposes tor service and basic status()', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                if (typeof log !== 'function') throw new Error('log must be a function');

                const readyApp = await waitForOrThrow(
                    async () => (app && app.services ? app : null),
                    'rectify app',
                    50,
                    100,
                );

                const tor = await waitForOrThrow(
                    async () => (readyApp.services && readyApp.services.tor ? readyApp.services.tor : null),
                    'service:tor',
                    50,
                    100,
                );

                requireObject(tor, 'tor service');
                requireFunction(tor.status, 'tor.status');
                requireFunction(tor.start, 'tor.start');
                requireFunction(tor.stop, 'tor.stop');

                const st = await tor.status();
                requireObject(st, 'tor.status result');
                assert.ok(st.ok === true, 'tor.status.ok must be true');

                log('ok', JSON.stringify(st));
            });
        });
    },
};
