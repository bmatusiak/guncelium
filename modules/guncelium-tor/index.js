'use strict';

function isElectronRenderer() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    const hasDom = (typeof window === 'object' && typeof window.document !== 'undefined');
    const hasPreloadBridge = !!(root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');
    return hasDom && hasPreloadBridge;
}

function isReactNative() {
    if (typeof navigator === 'object' && navigator && navigator.product === 'ReactNative') return true;
    const root = (typeof globalThis !== 'undefined') ? globalThis : null;
    return !!(root && typeof root === 'object' && root.__fbBatchedBridge);
}

function getElectronNativeServiceOrThrow(name) {
    if (typeof name !== 'string' || name.trim().length === 0) throw new Error('name must be a non-empty string');
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!root || typeof root !== 'object') throw new Error('globalThis not available');
    const nativeRoot = root.ElectronNative;
    if (!nativeRoot || typeof nativeRoot !== 'object') throw new Error('ElectronNative is not available (preload not loaded)');
    const svc = nativeRoot[name];
    if (!svc || typeof svc !== 'object') throw new Error(`ElectronNative['${name}'] not available`);
    if (svc._missing) throw new Error(`ElectronNative['${name}'] is marked missing`);
    return svc;
}

function createTorOrThrow() {
    if (isElectronRenderer()) {
        const impl = getElectronNativeServiceOrThrow('guncelium-tor');
        if (typeof impl.start !== 'function') throw new Error('ElectronNative guncelium-tor.start must be a function');
        if (typeof impl.stop !== 'function') throw new Error('ElectronNative guncelium-tor.stop must be a function');
        if (typeof impl.status !== 'function') throw new Error('ElectronNative guncelium-tor.status must be a function');
        return impl;
    }

    if (isReactNative()) {
        // eslint-disable-next-line global-require
        const createNative = require('./index.native');
        if (typeof createNative !== 'function') throw new Error('index.native.js must export a function');
        return createNative();
    }

    throw new Error('guncelium-tor is not implemented for this environment');
}

module.exports = createTorOrThrow;