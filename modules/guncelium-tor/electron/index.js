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

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

async function invokeOrThrow(ipcRenderer, channel, payload) {
    requireObject(ipcRenderer, 'ipcRenderer');
    if (typeof ipcRenderer.invoke !== 'function') throw new Error('ipcRenderer.invoke must be a function');
    if (!isNonEmptyString(channel)) throw new Error('channel must be a non-empty string');

    const result = await ipcRenderer.invoke(channel, payload);
    if (!result || typeof result !== 'object') return result;

    if (result.ok === false) {
        const msg = isNonEmptyString(result.error) ? result.error : 'tor operation failed';
        throw new Error(msg);
    }
    if (isNonEmptyString(result.error)) {
        throw new Error(result.error);
    }
    return result;
}

function createTorElectronApi() {
    const ipcRenderer = requireElectronIpcRendererOrThrow();
    const CHANNEL_PREFIX = 'tor:';

    return {
        install: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'install', opts || {});
        },
        uninstall: async () => {
            return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'uninstall');
        },
        info: async () => {
            return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'info');
        },
        start: async (opts) => {
            if (opts !== undefined) requireObject(opts, 'opts');
            return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'start', opts || {});
        },
        stop: async () => {
            return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'stop');
        },
        hiddenServices: {
            save: async (opts) => {
                if (opts !== undefined) requireObject(opts, 'opts');
                return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'hidden-services:save', opts || {});
            },
            list: async () => {
                return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'hidden-services:list');
            },
            create: async (opts) => {
                if (opts !== undefined) requireObject(opts, 'opts');
                return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'hidden-services:create', opts || {});
            },
            status: async () => {
                return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'hidden-services:status');
            },
        },
        control: {
            check: async (opts) => {
                if (opts !== undefined) requireObject(opts, 'opts');
                return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'control:check', opts || {});
            },
        },
        status: async () => {
            // tor:info returns installed/running and is the canonical status shape.
            return invokeOrThrow(ipcRenderer, CHANNEL_PREFIX + 'info');
        },
    };
}

module.exports = createTorElectronApi();