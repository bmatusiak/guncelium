'use strict';

const net = require('net');
const crypto = require('crypto');

const { createSocketAdapterOrThrow } = require('../index');

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
    return value;
}

function requirePositiveInt(value, name, max) {
    const n = Number(value);
    const hi = Number(max);
    if (!Number.isInteger(n) || n <= 0 || n > hi) throw new Error(`${name} must be int 1..${hi}`);
    return n;
}

function newId() {
    return crypto.randomBytes(8).toString('hex');
}

function createState() {
    return {
        servers: new Map(),
    };
}

function registerIpcHandlersOrThrow({ ipcMain }) {
    requireObject(ipcMain, 'ipcMain');
    requireFunction(ipcMain.handle, 'ipcMain.handle');

    const state = createState();

    ipcMain.handle('protocal:server:start', async (_event, opts) => {
        void _event;
        requireObject(opts, 'opts');

        const peerId = requireNonEmptyString(opts.peerId, 'opts.peerId');
        const helloTimeoutMs = opts.helloTimeoutMs === undefined ? 5000 : requirePositiveInt(opts.helloTimeoutMs, 'opts.helloTimeoutMs', 60000);

        const adapter = createSocketAdapterOrThrow(net, {
            enableHello: true,
            peerId,
            helloTimeoutMs,
        });

        const serverId = newId();

        let gotPing = false;
        let pendingResolve = null;
        let pendingReject = null;

        const server = adapter.listen(0, (peer) => {
            try {
                peer.onmessage = (ev) => {
                    const d = ev && ev.data !== undefined ? ev.data : null;
                    if (d && typeof d === 'object' && d.t === 'ping') {
                        gotPing = true;
                        try { peer.send({ t: 'pong' }); } catch (_e) { }
                        if (pendingResolve) {
                            const r = pendingResolve;
                            pendingResolve = null;
                            pendingReject = null;
                            r({ ok: true, gotPing: true });
                        }
                    }
                };
            } catch (_e) {
                try { peer.close(); } catch (_e2) { }
            }
        }, '127.0.0.1');

        const port = await new Promise((resolve, reject) => {
            let settled = false;
            const onErr = (e) => {
                if (settled) return;
                settled = true;
                reject(e instanceof Error ? e : new Error(String(e)));
            };
            server.once('error', onErr);
            server.once('listening', () => {
                if (settled) return;
                settled = true;
                server.removeListener('error', onErr);
                const a = server.address();
                const p = a && typeof a === 'object' ? Number(a.port) : 0;
                if (!Number.isInteger(p) || p <= 0 || p > 65535) return reject(new Error('server.address().port invalid'));
                resolve(p);
            });
        });

        state.servers.set(serverId, {
            server,
            gotPing: () => gotPing,
            setWaiter: (resolve, reject) => { pendingResolve = resolve; pendingReject = reject; },
            clearWaiter: () => { pendingResolve = null; pendingReject = null; },
        });

        return { ok: true, serverId, port };
    });

    ipcMain.handle('protocal:server:waitPing', async (_event, opts) => {
        void _event;
        requireObject(opts, 'opts');

        const serverId = requireNonEmptyString(opts.serverId, 'opts.serverId');
        const timeoutMs = opts.timeoutMs === undefined ? 60000 : requirePositiveInt(opts.timeoutMs, 'opts.timeoutMs', 180000);

        const entry = state.servers.get(serverId);
        if (!entry) throw new Error(`unknown serverId: ${serverId}`);
        if (entry.gotPing()) return { ok: true, gotPing: true };

        return await new Promise((resolve, reject) => {
            let settled = false;
            const t = setTimeout(() => {
                if (settled) return;
                settled = true;
                entry.clearWaiter();
                reject(new Error('timeout waiting for ping'));
            }, timeoutMs);

            entry.setWaiter(
                (r) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(t);
                    resolve(r);
                },
                (e) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(t);
                    reject(e);
                },
            );
        });
    });

    ipcMain.handle('protocal:server:stop', async (_event, opts) => {
        void _event;
        requireObject(opts, 'opts');

        const serverId = requireNonEmptyString(opts.serverId, 'opts.serverId');
        const entry = state.servers.get(serverId);
        if (!entry) return { ok: true, stopped: false };

        state.servers.delete(serverId);

        await new Promise((resolve) => {
            try {
                entry.clearWaiter();
                entry.server.close(() => resolve());
            } catch (_e) {
                resolve();
            }
        });

        return { ok: true, stopped: true };
    });

    return { ok: true };
}

module.exports = {
    registerIpcHandlersOrThrow,
};
