'use strict';

function requireElectronIpcRendererOrThrow() {
    const electron = require('electron');
    if (!electron || typeof electron !== 'object') throw new Error('electron module not available');
    const ipcRenderer = electron.ipcRenderer;
    if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') throw new Error('electron.ipcRenderer.invoke not available');
    return ipcRenderer;
}

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function createGunElectronApi() {
    const ipcRenderer = requireElectronIpcRendererOrThrow();
    const CHANNEL_PREFIX = 'gun:';

    return {
        start: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'start', opts || {});
        },
        stop: async () => {
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'stop');
        },
        status: async () => {
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'status');
        },
    };
}

module.exports = createGunElectronApi();