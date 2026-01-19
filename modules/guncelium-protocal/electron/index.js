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

function createProtocalElectronApi() {
    const ipcRenderer = requireElectronIpcRendererOrThrow();
    const CHANNEL_PREFIX = 'protocal:';

    return {
        serverStart: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'server:start', opts || {});
        },
        serverWaitPing: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'server:waitPing', opts || {});
        },
        serverStop: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'server:stop', opts || {});
        },
    };
}

module.exports = createProtocalElectronApi();
