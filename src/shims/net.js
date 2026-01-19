'use strict';

function isElectronRenderer() {
    if (typeof window !== 'object' || !window) return false;
    const w = window;
    const hasProcess = !!(w.process && typeof w.process === 'object');
    const hasElectron = hasProcess && !!(w.process.versions && w.process.versions.electron);
    const isRenderer = hasProcess && w.process.type === 'renderer';
    return hasElectron && isRenderer;
}

function tryGetNodeNetOrNull() {
    if (isElectronRenderer() && typeof window.require === 'function') {
        try {
            return window.require('net');
        } catch (_e) {
            // ignore
        }
    }

    return null;
}

const realNet = tryGetNodeNetOrNull();

function notAvailable(name) {
    return () => {
        throw new Error(`net shim: ${String(name)} is not available in this runtime`);
    };
}

module.exports = realNet || {
    createServer: notAvailable('createServer'),
    createConnection: notAvailable('createConnection'),
};
