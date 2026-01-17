'use strict';

function isElectronRenderer() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    const hasDom = (typeof window === 'object' && typeof window.document !== 'undefined');
    const hasPreloadBridge = !!(root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');
    return hasDom && hasPreloadBridge;
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

function createGunOrThrow() {
    if (!isElectronRenderer()) {
        throw new Error('guncelium-gun requires the Electron preload bridge (ElectronNative)');
    }

    const impl = getElectronNativeServiceOrThrow('guncelium-gun');
    if (typeof impl.start !== 'function') throw new Error('ElectronNative guncelium-gun.start must be a function');
    if (typeof impl.stop !== 'function') throw new Error('ElectronNative guncelium-gun.stop must be a function');
    if (typeof impl.status !== 'function') throw new Error('ElectronNative guncelium-gun.status must be a function');
    return impl;
}

module.exports = createGunOrThrow;