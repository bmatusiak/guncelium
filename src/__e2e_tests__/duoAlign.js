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

async function waitForFlagOrThrow(getFlag, label, maxAttempts, delayMs) {
    requireFunction(getFlag, 'getFlag');
    requireString(label, 'label');
    const attempts = Number(maxAttempts);
    const delay = Number(delayMs);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 600) throw new Error('maxAttempts must be 1..600');
    if (!Number.isInteger(delay) || delay < 50 || delay > 2000) throw new Error('delayMs must be 50..2000');

    for (let i = 0; i < attempts; i++) {
        if (getFlag() === true) return true;
        // eslint-disable-next-line no-await-in-loop
        await sleepMsOrThrow(delay);
    }

    throw new Error(`timeout waiting for ${label}`);
}

function requireRoleOrThrow(value) {
    const s = String(value || '').trim().toLowerCase();
    if (s !== 'electron' && s !== 'android') throw new Error(`invalid role: ${String(value)}`);
    return s;
}

function otherRoleOrThrow(role) {
    const r = requireRoleOrThrow(role);
    return r === 'electron' ? 'android' : 'electron';
}

async function waitForServiceOrThrow(name) {
    requireString(name, 'service name');

    for (let i = 0; i < 60; i++) {
        // eslint-disable-next-line no-await-in-loop
        if (app && app.services && app.services[name]) return app.services[name];
        // eslint-disable-next-line no-await-in-loop
        await sleepMsOrThrow(100);
    }
    throw new Error(`timeout waiting for service:${name}`);
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
    name: 'DuoAlign',
    test: (h) => {
        if (!h || typeof h.describe !== 'function' || typeof h.it !== 'function') throw new Error('harness missing describe/it');

        // Only meaningful in Electron renderer + React Native.
        if (!isElectronRenderer() && !isReactNative()) return;

        h.describe('Duo: alignment', () => {
            h.it('both devices are online before Tor tests', async ({ assert, log }) => {
                requireObject(assert, 'assert');
                requireFunction(assert.ok, 'assert.ok');
                if (typeof log !== 'function') throw new Error('log must be a function');

                // Ensure core services are up before aligning.
                await waitForServiceOrThrow('moniker');

                const role = isElectronRenderer() ? 'electron' : 'android';
                const otherRole = otherRoleOrThrow(role);

                log('connecting to duo coordinator...');
                const coord = await connectDuoCoordinatorOrThrow();

                try {
                    let peerConnected = false;
                    let duoAligned = false;
                    coord.on('peerConnected', () => { peerConnected = true; });
                    coord.on('duoAligned', () => { duoAligned = true; });

                    await new Promise((resolve, reject) => {
                        coord.emit('register', { role }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duo register failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            return resolve();
                        });
                    });

                    log('waiting for peerConnected...');
                    await waitForFlagOrThrow(() => peerConnected, 'peerConnected (duo)', 240, 500);

                    log('signaling duoAligned...');
                    await new Promise((resolve, reject) => {
                        coord.emit('duoAligned', { role }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duoAligned ack failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            return resolve();
                        });
                    });

                    log('waiting for bothAligned...');
                    await waitForFlagOrThrow(() => duoAligned, 'duoAligned broadcast (duo)', 240, 500);

                    // Data swap + validation (proves bidirectional comms, not just presence).
                    const myValue = `${role}-${Date.now()}`;
                    let gotBoth = null;
                    coord.on('duoData', (p) => { gotBoth = p; });
                    log('sending duo data...');
                    await new Promise((resolve, reject) => {
                        coord.emit('duoData', { role, value: myValue }, (ack) => {
                            if (!ack || ack.ok !== true) return reject(new Error(`duoData ack failed: ${ack && ack.error ? ack.error : 'unknown'}`));
                            if (ack && ack.both && typeof ack.both === 'object') gotBoth = ack.both;
                            return resolve();
                        });
                    });
                    log('waiting for peer data...');
                    await waitForFlagOrThrow(() => !!gotBoth, 'duoData broadcast (duo)', 240, 500);

                    requireObject(gotBoth, 'duoData payload');
                    assert.ok(gotBoth.ok === true, 'duoData.ok true');
                    requireObject(gotBoth[role], 'duoData[role]');
                    requireObject(gotBoth[otherRole], 'duoData[otherRole]');
                    assert.ok(String(gotBoth[role].value) === myValue, 'received my echoed value');
                    assert.ok(String(gotBoth[otherRole].value).startsWith(`${otherRole}-`), 'received peer value prefix');
                    assert.ok(String(gotBoth[otherRole].value) !== myValue, 'peer value must differ');

                    assert.ok(true, 'duo aligned');
                } finally {
                    try { coord.close(); } catch (_e) { }
                }
            });
        });
    },
};
