'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
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

function registerIpcHandlersOrThrow({ ipcMain, electronApp }) {
    requireObject(ipcMain, 'ipcMain');
    requireFunction(ipcMain.handle, 'ipcMain.handle');
    requireObject(electronApp, 'electronApp');

    const controller = createGunMainControllerOrThrow({ electronApp });

    ipcMain.handle('gun:start', async (event, opts) => {
        return controller.start(opts);
    });

    ipcMain.handle('gun:stop', async () => {
        return controller.stop();
    });

    ipcMain.handle('gun:status', async () => {
        return controller.status();
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
};
