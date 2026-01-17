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

function createTorElectronApi() {
    const ipcRenderer = requireElectronIpcRendererOrThrow();
    const CHANNEL_PREFIX = 'tor:';

    return {
        install: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'install', opts || {});
        },
        uninstall: async () => {
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'uninstall');
        },
        info: async () => {
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'info');
        },
        start: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'start', opts || {});
        },
        stop: async () => {
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'stop');
        },
        hiddenServices: {
            save: async (opts) => {
                if (opts !== undefined) requireObject(opts, 'opts');
                return ipcRenderer.invoke(CHANNEL_PREFIX + 'hidden-services:save', opts || {});
            },
            list: async () => {
                return ipcRenderer.invoke(CHANNEL_PREFIX + 'hidden-services:list');
            },
            create: async (opts) => {
                if (opts !== undefined) requireObject(opts, 'opts');
                return ipcRenderer.invoke(CHANNEL_PREFIX + 'hidden-services:create', opts || {});
            },
            status: async () => {
                return ipcRenderer.invoke(CHANNEL_PREFIX + 'hidden-services:status');
            },
        },
        control: {
            check: async (opts) => {
                if (opts !== undefined) requireObject(opts, 'opts');
                return ipcRenderer.invoke(CHANNEL_PREFIX + 'control:check', opts || {});
            },
        },
        status: async () => {
            // tor:info returns installed/running and is the canonical status shape.
            return ipcRenderer.invoke(CHANNEL_PREFIX + 'info');
        },
    };
}

module.exports = createTorElectronApi();