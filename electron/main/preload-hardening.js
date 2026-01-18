'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function hardenInvokeOrThrow() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    requireObject(root, 'globalThis');

    const electronApi = root.electron;
    requireObject(electronApi, 'window.electron');

    const origInvoke = electronApi.invoke;
    requireFunction(origInvoke, 'window.electron.invoke');

    electronApi.invoke = (channel, data) => {
        requireString(channel, 'invoke channel');
        const res = origInvoke(channel, data);
        // Generated preload returns `undefined` when channel is not allowlisted.
        if (!res || typeof res.then !== 'function') {
            throw new Error(`electron.invoke channel not allowed: ${channel}`);
        }
        return res;
    };

    return true;
}

hardenInvokeOrThrow();
