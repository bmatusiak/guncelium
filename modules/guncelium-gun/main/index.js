'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');

const { createSocketAdapterOrThrow } = require('guncelium-protocal');

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireObjectLike(value, name) {
    const t = typeof value;
    if (!value || (t !== 'object' && t !== 'function')) throw new Error(`${name} must be an object or function`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requireInteger(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
    return n;
}

function ensureDirOrThrow(dirPath) {
    requireString(dirPath, 'dirPath');
    if (fs.existsSync(dirPath)) {
        const st = fs.statSync(dirPath);
        if (!st.isDirectory()) throw new Error(`expected directory at ${dirPath}`);
        return;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    const st = fs.statSync(dirPath);
    if (!st.isDirectory()) throw new Error(`failed to create directory at ${dirPath}`);
}

function resolveStoreDirOrThrow(electronApp, opts) {
    requireObject(electronApp, 'electronApp');
    requireFunction(electronApp.getPath, 'electronApp.getPath');

    const override = opts && (opts.storeDir || opts.radataDir || opts.file);
    if (override !== undefined && override !== null) {
        requireString(override, 'opts.storeDir');
        ensureDirOrThrow(override);
        return override;
    }

    const userData = electronApp.getPath('userData');
    requireString(userData, 'electronApp.getPath(userData)');
    const dir = path.join(userData, 'gun', 'radata');
    ensureDirOrThrow(dir);
    return dir;
}

function createGunMainControllerOrThrow({ electronApp }) {
    requireObject(electronApp, 'electronApp');

    // NOTE: Gun is an app dependency under this package.
    // eslint-disable-next-line global-require
    const Gun = require('gun/lib/server.js');
    // eslint-disable-next-line global-require
    require('gun/sea');

    const state = {
        server: null,
        port: null,
        gun: null,
        storeDir: null,
    };

    async function listenOrThrow(server, port) {
        requireObject(server, 'server');
        const p = requireInteger(port, 'port');
        if (p < 0 || p > 65535) throw new Error('port must be in 0..65535');

        await new Promise((resolve, reject) => {
            const onError = (err) => {
                server.removeListener('listening', onListening);
                reject(err);
            };
            const onListening = () => {
                server.removeListener('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(p);
        });
    }

    async function closeOrThrow(server) {
        requireObject(server, 'server');
        await new Promise((resolve, reject) => {
            server.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async function start(opts) {
        if (state.server) throw new Error('gun already running');
        const o = opts && typeof opts === 'object' ? opts : {};
        const desiredPort = (o.port === undefined || o.port === null) ? 0 : requireInteger(o.port, 'opts.port');
        if (desiredPort < 0 || desiredPort > 65535) throw new Error('opts.port must be in 0..65535');

        const storeDir = resolveStoreDirOrThrow(electronApp, o);
        const peers = Array.isArray(o.peers) ? o.peers : [];

        const server = http.createServer((req, res) => res.end('gun'));
        await listenOrThrow(server, desiredPort);
        const addr = server.address();
        if (!addr || typeof addr !== 'object' || !addr.port) throw new Error('gun server missing bound port');

        const port = addr.port;
        const gun = Gun({ web: server, peers, file: storeDir });
        if (!gun || typeof gun !== 'function') {
            throw new Error('gun initialization failed');
        }

        state.server = server;
        state.port = port;
        state.gun = gun;
        state.storeDir = storeDir;

        return { ok: true, running: true, port, storeDir };
    }

    async function stop() {
        if (!state.server) throw new Error('gun not running');
        const s = state.server;
        await closeOrThrow(s);
        state.server = null;
        state.port = null;
        state.gun = null;
        state.storeDir = null;
        return { ok: true, running: false };
    }

    async function status() {
        return {
            ok: true,
            running: !!state.server,
            port: state.port,
            storeDir: state.storeDir,
        };
    }

    return { start, stop, status };
}

function requireArray(value, name) {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}

function normalizePeerTargetsOrThrow(peers) {
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

function parseHostPortOrThrow(s) {
    requireString(s, 'peer');

    const stripped = s.replace(/^tcp:\/\//, '');
    const m = stripped.match(/^(.+?):(\d{1,5})$/);
    if (!m) throw new Error(`peer must be host:port (or tcp://host:port), got: ${s}`);
    const host = m[1];
    const port = requireInteger(m[2], 'peer.port');
    if (port < 1 || port > 65535) throw new Error('peer.port must be in 1..65535');
    requireString(host, 'peer.host');
    return { host, port, url: `tcp://${host}:${port}` };
}

function randomIdOrThrow(prefix) {
    requireString(prefix, 'prefix');
    const buf = crypto.randomBytes(8);
    if (!buf || typeof buf.toString !== 'function') throw new Error('randomBytes failed');
    return `${prefix}-${buf.toString('hex')}`;
}

function crashAsyncOrThrow(e) {
    const err = (e instanceof Error) ? e : new Error(String(e));
    setTimeout(() => { throw err; }, 0);
    throw err;
}

async function waitForServerListeningOrThrow(server) {
    requireObject(server, 'server');
    if (typeof server.once !== 'function') throw new Error('server.once must be a function');
    if (typeof server.listening === 'boolean' && server.listening) return;

    await new Promise((resolve, reject) => {
        const onError = (err) => {
            server.removeListener('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
    });
}

function requireGunMeshOrThrow(gun) {
    requireObjectLike(gun, 'gun');
    const opt = gun._ && gun._.opt;
    if (!opt || typeof opt !== 'object') throw new Error('gun opt missing');
    const mesh = opt.mesh;
    if (!mesh || typeof mesh !== 'function') throw new Error('gun mesh missing');
    if (typeof mesh.hear !== 'function') throw new Error('gun mesh.hear missing');
    if (typeof mesh.hi !== 'function') throw new Error('gun mesh.hi missing');
    if (typeof mesh.bye !== 'function') throw new Error('gun mesh.bye missing');
    return mesh;
}

function attachWireToPeerOrThrow(mesh, peer, wire) {
    requireFunction(mesh, 'mesh');
    requireObject(peer, 'peer');
    requireObject(wire, 'wire');

    peer.wire = wire;
    wire.onmessage = (ev) => {
        if (!ev) throw new Error('wire message event missing');
        mesh.hear(ev.data, peer);
    };
    wire.onopen = () => {
        mesh.hi(peer);
    };
    wire.onclose = () => {
        mesh.bye(peer);
    };
    wire.onerror = () => {
        mesh.bye(peer);
    };
}

function installMeshWireOrThrow(mesh, socket) {
    requireFunction(mesh, 'mesh');
    requireObject(socket, 'socket');
    if (typeof socket.connect !== 'function') throw new Error('socket.connect must be a function');

    mesh.wire = (peer) => {
        requireObject(peer, 'peer');
        if (peer.wire) return;
        if (!peer.url) throw new Error('peer.url is required');

        const { host, port, url } = parseHostPortOrThrow(String(peer.url));
        peer.url = url;

        socket.connect(host, port).then((wire) => {
            attachWireToPeerOrThrow(mesh, peer, wire);
        }).catch((e) => {
            crashAsyncOrThrow(e);
        });
    };
}

function createGunTcpMeshControllerOrThrow({ electronApp }) {
    requireObject(electronApp, 'electronApp');

    // eslint-disable-next-line global-require
    const Gun = require('gun/gun');
    // eslint-disable-next-line global-require
    require('gun/lib/wire');
    // eslint-disable-next-line global-require
    require('gun/sea');

    const socket = createSocketAdapterOrThrow(net, {});

    const state = { server: null, port: null, gun: null, storeDir: null };

    async function startTcp(opts) {
        if (state.server) throw new Error('gun tcp already running');
        const o = opts && typeof opts === 'object' ? opts : {};
        const desiredPort = (o.port === undefined || o.port === null) ? 0 : requireInteger(o.port, 'opts.port');
        if (desiredPort < 0 || desiredPort > 65535) throw new Error('opts.port must be in 0..65535');
        const host = (o.host === undefined || o.host === null) ? '127.0.0.1' : String(o.host);
        requireString(host, 'opts.host');

        const storeDir = resolveStoreDirOrThrow(electronApp, o);
        const peers = normalizePeerTargetsOrThrow(o.peers);

        const gun = Gun({ file: storeDir, peers: [] });
        if (!gun) throw new Error('gun initialization failed');
        if (typeof gun.get !== 'function') throw new Error('gun initialization failed (missing get)');

        state.gun = gun;
        state.storeDir = storeDir;

        const mesh = requireGunMeshOrThrow(gun);
        installMeshWireOrThrow(mesh, socket);

        const server = socket.listen(desiredPort, (wire) => {
            const peer = { id: null, url: randomIdOrThrow('tcp-in'), wire: null };
            attachWireToPeerOrThrow(mesh, peer, wire);
        }, host);

        await waitForServerListeningOrThrow(server);

        const addr = server.address && server.address();
        if (!addr || typeof addr !== 'object' || !addr.port) throw new Error('gun tcp server missing bound port');

        state.server = server;
        state.port = addr.port;

        for (let i = 0; i < peers.length; i++) {
            const t = parseHostPortOrThrow(peers[i]);
            mesh.hi({ url: t.url, id: t.url });
        }

        return { ok: true, running: true, port: state.port, host, storeDir };
    }

    async function stopTcp() {
        if (!state.server) throw new Error('gun tcp not running');
        const s = state.server;
        await new Promise((resolve, reject) => {
            s.close((err) => (err ? reject(err) : resolve()));
        });
        state.server = null;
        state.port = null;
        state.gun = null;
        state.storeDir = null;
        return { ok: true, running: false };
    }

    async function statusTcp() {
        return {
            ok: true,
            running: !!state.server,
            port: state.port,
            storeDir: state.storeDir,
        };
    }

    return { startTcp, stopTcp, statusTcp };
}

function registerIpcHandlersOrThrow({ ipcMain, electronApp }) {
    requireObject(ipcMain, 'ipcMain');
    requireFunction(ipcMain.handle, 'ipcMain.handle');
    requireObject(electronApp, 'electronApp');

    const controller = createGunMainControllerOrThrow({ electronApp });
    const tcpController = createGunTcpMeshControllerOrThrow({ electronApp });

    ipcMain.handle('gun:start', async (event, opts) => {
        return controller.start(opts);
    });

    ipcMain.handle('gun:stop', async () => {
        return controller.stop();
    });

    ipcMain.handle('gun:status', async () => {
        return controller.status();
    });

    ipcMain.handle('gun:tcp:start', async (event, opts) => {
        return tcpController.startTcp(opts);
    });

    ipcMain.handle('gun:tcp:stop', async () => {
        return tcpController.stopTcp();
    });

    ipcMain.handle('gun:tcp:status', async () => {
        return tcpController.statusTcp();
    });

    ipcMain.handle('gun:ws-info', async () => {
        const st = await controller.status();
        if (!st || st.running !== true || !st.port) throw new Error('gun not running');
        const host = '127.0.0.1';
        const port = st.port;
        const httpUrl = `http://${host}:${port}/gun`;
        const wsUrl = `ws://${host}:${port}/gun`;
        return { ok: true, host, port, url: httpUrl, httpUrl, wsUrl };
    });
}

module.exports = {
    registerIpcHandlersOrThrow,
    createGunMainControllerOrThrow,
    createGunTcpMeshControllerOrThrow,
};
