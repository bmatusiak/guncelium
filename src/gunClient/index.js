import Gun from 'gun/gun';
import 'gun/sea.js';

setup.consumes = ['app', 'gun'];
setup.provides = ['gunClient'];

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireInteger(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
    return n;
}

function isElectronRenderer() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    return !!(root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');
}

function peerUrlFromGunStatusOrThrow(st) {
    requireObject(st, 'gun.status result');
    if (st.running !== true) throw new Error('gun is not running (cannot create renderer client)');
    const port = requireInteger(st.port, 'gun.status.port');
    if (port < 1 || port > 65535) throw new Error('gun.status.port must be in 1..65535');
    return `http://localhost:${port}/gun`;
}

function closeWiresOrThrow(gun) {
    const t = typeof gun;
    if (!gun || (t !== 'function' && t !== 'object')) throw new Error('gun instance must be an object or function');

    const opt = gun._ && gun._.opt;
    if (!opt || typeof opt !== 'object') throw new Error('gun opt missing');

    const peers = opt.peers;
    if (!peers || typeof peers !== 'object') throw new Error('gun opt.peers missing');

    const keys = Object.keys(peers);
    const MAX = 64;
    if (keys.length > MAX) throw new Error('peer count exceeds bound (64)');

    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const peer = peers[k];
        if (!peer || typeof peer !== 'object') continue;
        const wire = peer.wire;
        if (wire && typeof wire.close === 'function') {
            wire.close();
        }
    }

    requireFunction(gun.off, 'gun.off');
    gun.off();
}

export default function setup(imports, register) {
    requireObject(imports, 'imports');
    requireObject(imports.app, 'imports.app');
    requireObject(imports.gun, 'imports.gun');
    requireFunction(imports.gun.status, 'imports.gun.status');
    if (typeof register !== 'function') throw new Error('register must be a function');

    const state = {
        gun: null,
        peerUrl: null,
        connectedAt: null,
    };

    async function connect() {
        if (!isElectronRenderer()) throw new Error('gunClient.connect is Electron-renderer only');
        if (state.gun) return status();

        const st = await imports.gun.status();
        const peerUrl = peerUrlFromGunStatusOrThrow(st);

        const gun = Gun({
            peers: [peerUrl],
            localStorage: false,
        });
        const gunType = typeof gun;
        if (!gun || (gunType !== 'function' && gunType !== 'object')) throw new Error('Gun() did not return an instance');
        if (typeof gun.get !== 'function') throw new Error('Gun() instance missing get()');

        state.gun = gun;
        state.peerUrl = peerUrl;
        state.connectedAt = Date.now();

        return status();
    }

    async function disconnect() {
        if (!state.gun) throw new Error('gun client not connected');
        closeWiresOrThrow(state.gun);

        state.gun = null;
        state.peerUrl = null;
        state.connectedAt = null;

        return status();
    }

    function get() {
        if (!state.gun) throw new Error('gun client not connected');
        return state.gun;
    }

    function status() {
        return {
            ok: true,
            connected: !!state.gun,
            peerUrl: state.peerUrl,
            connectedAt: state.connectedAt,
        };
    }

    register(null, {
        gunClient: {
            connect,
            disconnect,
            get,
            status,
        },
    });
}
