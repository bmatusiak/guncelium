const fs = require('fs');
const { getTorPaths } = require('./paths');
const { installTor } = require('./installer');
const { getTorInfo } = require('./info');
const { createHiddenServices, readHiddenServicesStatus } = require('./hiddenServices');
const { controlPortProtocolInfo } = require('./controlPort');
const { startTorProcess } = require('./process');

const { ensureMinimalTorrc, writeMinimalTorrc, sanitizeTorrc, cleanupHiddenServices } = require('./torrcUtil');
const { isPortFree } = require('./netUtil');
const { stopProcessGracefully } = require('./procUtil');

function broadcastToRenderersOrThrow(channel, payload) {
    if (!channel || typeof channel !== 'string') throw new Error('channel is required');
    const { webContents } = require('electron');
    if (!webContents || typeof webContents.getAllWebContents !== 'function') throw new Error('electron.webContents is not available');

    const all = webContents.getAllWebContents();
    if (!Array.isArray(all)) throw new Error('electron.webContents.getAllWebContents() must return an array');
    for (const wc of all) {
        if (!wc || typeof wc.send !== 'function') continue;
        if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) continue;
        wc.send(channel, payload);
    }
}

function registerTorIpc({ ipcMain, app, state }) {
    ipcMain.handle('tor:install', async (event, opts = {}) => {
        try {
            return await installTor({ app, version: opts.version });
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:info', async () => {
        try {
            return await getTorInfo({ app, torChild: state.torChild });
        } catch (e) {
            return { installed: false, running: false, error: e.message };
        }
    });

    ipcMain.handle('tor:uninstall', async () => {
        try {
            const { torDir } = getTorPaths(app);
            // Stop tor if running
            if (state.torChild && !state.torChild.killed) {
                const { exited } = await stopProcessGracefully({ child: state.torChild, timeoutMs: 2500 });
                if (!exited) return { ok: false, error: 'failed to stop tor before uninstall' };
            }
            state.torChild = null;
            fs.rmSync(torDir, { recursive: true, force: true });
            return { ok: true, removed: torDir };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:start', async (event, opts = {}) => {
        try {
            if (state.torChild && !state.torChild.killed) return { ok: false, error: 'tor already running', pid: state.torChild.pid };
            const info = await getTorInfo({ app, torChild: state.torChild });
            if (!info || !info.installed) return { ok: false, error: 'tor not installed' };
            if (!info.path) return { ok: false, error: 'tor binary not found' };

            const { torrcPath, dataDir } = getTorPaths(app);
            const cleanSlate = (opts && typeof opts.cleanSlate === 'boolean') ? opts.cleanSlate : true;

            // Clean slate: Tor start should NOT remember old Gun attachments.
            // This wipes hidden service dirs + results AND forces a minimal torrc.
            if (cleanSlate) {
                const { hsBaseDir, hiddenServicesResultsFile } = getTorPaths(app);
                cleanupHiddenServices({ hsBaseDir, hiddenServicesResultsFile });
                writeMinimalTorrc({ torrcPath, dataDir });
            } else {
                ensureMinimalTorrc({ torrcPath, dataDir });
                sanitizeTorrc({ torrcPath, dataDir });
            }

            const controlHost = '127.0.0.1';
            const chosenPort = 9051;
            // After a tor stop/restart, the OS may hold the port briefly.
            // Wait a bounded amount of time before failing.
            let free = false;
            for (let i = 0; i < 15; i++) {
                // eslint-disable-next-line no-await-in-loop
                free = await isPortFree(controlHost, chosenPort);
                if (free) break;
                // eslint-disable-next-line no-await-in-loop
                await new Promise(r => setTimeout(r, 150));
            }
            if (!free) return { ok: false, error: 'ControlPort 9051 is not available' };
            state.controlPort = chosenPort;

            const args = [];
            if (fs.existsSync(torrcPath)) args.push('-f', torrcPath);
            // Always enable loopback ControlPort for status queries (CookieAuth). This is local-only.
            args.push('--ControlPort', `${controlHost}:${chosenPort}`);
            args.push('--CookieAuthentication', '1');

            const proc = startTorProcess({ app, torPath: info.path, args });
            state.torChild = proc.child;
            state.torLogFile = proc.logFile;
            state.getTorLastError = proc.getLastError;
            state.getTorLastExit = proc.getLastExit;

            proc.child.unref && proc.child.unref();
            proc.child.on('exit', async () => {
                state.torChild = null;
                try {
                    const updated = await getTorInfo({ app, torChild: state.torChild });
                    broadcastToRenderersOrThrow('tor:info-changed', updated);
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('failed to broadcast tor exit:', e);
                }
            });

            // If tor fails immediately, don't return a misleading ok:true.
            const pid = proc.child.pid;
            const exitedQuickly = await new Promise((resolve) => {
                let settled = false;
                const t = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    resolve(false);
                }, 600);
                proc.child.once('exit', () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(t);
                    resolve(true);
                });
            });

            if (exitedQuickly) {
                const lastExit = state.getTorLastExit ? state.getTorLastExit() : null;
                const lastErr = state.getTorLastError ? state.getTorLastError() : null;
                return { ok: false, error: 'tor exited immediately', pid, lastExit, torLastError: lastErr, torLogFile: state.torLogFile || null, controlPort: chosenPort };
            }

            // Fail-fast: ControlPort diagnostics must come up if we enabled ControlPort.
            let controlOk = false;
            for (let i = 0; i < 10; i++) {
                // eslint-disable-next-line no-await-in-loop
                const r = await controlPortProtocolInfo(controlHost, chosenPort, 300);
                if (r && r.ok) { controlOk = true; break; }
                // eslint-disable-next-line no-await-in-loop
                await new Promise(r2 => setTimeout(r2, 150));
            }
            if (!controlOk) {
                await stopProcessGracefully({ child: proc.child, timeoutMs: 2500 });
                state.torChild = null;
                return { ok: false, error: 'ControlPort did not become ready' };
            }

            const updated = await getTorInfo({ app, torChild: state.torChild });
            broadcastToRenderersOrThrow('tor:info-changed', updated);
            return { ok: true, pid, controlPort: chosenPort };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:stop', async () => {
        try {
            if (!state.torChild) return { ok: false, error: 'tor not running' };

            const { exited, pid } = await stopProcessGracefully({ child: state.torChild, timeoutMs: 2500 });
            state.torChild = null;
            const updated = await getTorInfo({ app, torChild: state.torChild });
            broadcastToRenderersOrThrow('tor:info-changed', updated);
            return { ok: true, pid, exited };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:hidden-services:save', async (event, opts = {}) => {
        try {
            const { hiddenServicesFile, torDir } = getTorPaths(app);
            if (!fs.existsSync(torDir)) fs.mkdirSync(torDir, { recursive: true });
            const payload = { keys: Array.isArray(opts.keys) ? opts.keys : (opts || {}).keys || [] };
            fs.writeFileSync(hiddenServicesFile, JSON.stringify(payload, null, 2), { encoding: 'utf8' });
            return { ok: true, path: hiddenServicesFile, keys: payload.keys };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:hidden-services:list', async () => {
        try {
            const { hiddenServicesFile } = getTorPaths(app);
            if (!fs.existsSync(hiddenServicesFile)) return { ok: true, keys: [] };
            const parsed = JSON.parse(fs.readFileSync(hiddenServicesFile, 'utf8') || '{}');
            return { ok: true, keys: parsed.keys || [] };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:hidden-services:create', async (event, opts = {}) => {
        try {
            const keys = Array.isArray(opts.keys) ? opts.keys : (opts && opts.keys) || [];
            const localPort = opts.port || null;
            const virtualPort = (opts && opts.virtualPort) ? Number(opts.virtualPort) : 80;
            const serviceName = opts && opts.service ? String(opts.service) : null;
            const enableControlPort = !!(opts && opts.controlPort);
            return createHiddenServices({ app, keys, localPort, virtualPort, serviceName, enableControlPort });
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:hidden-services:status', async () => {
        try {
            const torLastError = state.getTorLastError ? state.getTorLastError() : null;
            if (!state.controlPort) return { ok: false, error: 'controlPort not set (tor not started via app)' };
            return await readHiddenServicesStatus({
                app,
                torChild: state.torChild,
                torLogFile: state.torLogFile || null,
                torLastError,
                controlHost: '127.0.0.1',
                controlPort: state.controlPort,
            });
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });

    ipcMain.handle('tor:control:check', async (event, opts = {}) => {
        try {
            if (!opts || !opts.host || !opts.port) throw new Error('host and port are required');
            const host = String(opts.host);
            const port = Number(opts.port);
            return await controlPortProtocolInfo(host, port, 1000);
        } catch (e) {
            return { ok: false, error: e.message };
        }
    });
}

module.exports = { registerTorIpc };
