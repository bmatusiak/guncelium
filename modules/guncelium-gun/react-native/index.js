'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireArray(value, name) {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}

function requireObjectLike(value, name) {
    const t = typeof value;
    if (!value || (t !== 'object' && t !== 'function')) throw new Error(`${name} must be an object or function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function normalizePeersOrThrow(peers) {
    if (peers === undefined || peers === null) return [];
    requireArray(peers, 'opts.peers');

    const out = [];
    for (let i = 0; i < peers.length; i++) {
        const raw = peers[i];
        if (raw === undefined || raw === null) continue;
        requireString(raw, 'peer');
        const s = String(raw).trim();
        if (!s) continue;
        out.push(s);
        if (out.length >= 32) throw new Error('opts.peers exceeds limit (32)');
    }
    return out;
}

function ensureNativeSeaInstalledOrThrow(Gun) {
    if (!Gun) throw new Error('Gun is required');

    const root = (typeof globalThis !== 'undefined')
        ? globalThis
        : ((typeof global !== 'undefined') ? global : null);
    if (!root || typeof root !== 'object') throw new Error('global root not available');
    if (!root.window) root.window = root;

    // eslint-disable-next-line global-require
    const nativeSeaImport = require('native-sea');
    const nativeSea = (nativeSeaImport && nativeSeaImport.default) ? nativeSeaImport.default : nativeSeaImport;
    if (!nativeSea || typeof nativeSea.install !== 'function') throw new Error('native-sea.install must be a function');

    // The installer is idempotent (checks Gun.RN).
    nativeSea.install(Gun);

    if (!Gun.SEA) throw new Error('Gun.SEA must be available after installing native-sea');
    if (Gun.RN !== true) throw new Error('native-sea did not set Gun.RN');
}

function createGunReactNativeApiOrThrow() {
    // DONT EDIT THESE REQUIRE LINES BELOW HERE (keeps Metro/bundlers happy)
    // eslint-disable-next-line global-require
    const Gun = require('gun/gun');
    // eslint-disable-next-line global-require
    require('gun/sea.js');

    ensureNativeSeaInstalledOrThrow(Gun);

    const state = {
        gun: null,
        peers: [],
    };

    function get() {
        if (!state.gun) throw new Error('gun not running');
        return state.gun;
    }

    async function start(opts) {
        if (state.gun) throw new Error('gun already running');
        const o = (opts && typeof opts === 'object') ? opts : {};

        // API-compat with Electron: GunPanel passes { port: 0 }.
        // React Native build is a client; only port=0 (or unset) is accepted.
        if (o.port !== undefined && o.port !== null) {
            const p = Number(o.port);
            if (!Number.isInteger(p) || p !== 0) throw new Error('react-native gun does not support hosting (opts.port must be 0)');
        }

        const peers = normalizePeersOrThrow(o.peers);

        const gun = Gun({
            peers,
            localStorage: false,
        });
        requireObjectLike(gun, 'gun');
        if (typeof gun.get !== 'function') throw new Error('gun initialization failed (missing get)');

        state.gun = gun;
        state.peers = peers;

        return { ok: true, running: true, port: null, storeDir: null, peers };
    }

    async function stop() {
        if (!state.gun) throw new Error('gun not running');
        const gun = state.gun;
        state.gun = null;
        state.peers = [];

        requireObjectLike(gun, 'gun');
        if (typeof gun.off !== 'function') throw new Error('gun.off must be a function to stop gun');
        gun.off();

        return { ok: true, running: false };
    }

    async function status() {
        return {
            ok: true,
            running: !!state.gun,
            port: null,
            storeDir: null,
            peers: state.peers,
            mode: 'react-native',
            nativeSea: true,
        };
    }

    return { start, stop, status, get };
}

module.exports = createGunReactNativeApiOrThrow;
