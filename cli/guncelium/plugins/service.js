'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

setup.consumes = ['args', 'app'];
setup.provides = [];

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
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
    fs.mkdirSync(dirPath, { recursive: true });
    const st = fs.statSync(dirPath);
    if (!st.isDirectory()) throw new Error(`expected directory at ${dirPath}`);
}

function resolveUserDataDirOrThrow(flags) {
    if (flags['data-dir'] !== undefined && flags['data-dir'] !== true) {
        const p = String(flags['data-dir']);
        ensureDirOrThrow(p);
        return p;
    }

    const xdg = process.env.XDG_STATE_HOME;
    if (xdg && String(xdg).trim()) {
        const p = path.join(String(xdg), 'guncelium');
        ensureDirOrThrow(p);
        return p;
    }

    const home = os.homedir();
    requireString(home, 'os.homedir()');
    const p = path.join(home, '.local', 'state', 'guncelium');
    ensureDirOrThrow(p);
    return p;
}

function printHelp() {
    // eslint-disable-next-line no-console
    console.log([
        'guncelium (node service)',
        '',
        'Commands:',
        '  help                     Show this help',
        '  service                  Start Gun TCP (and optional Tor HS) and run until SIGINT/SIGTERM',
        '  tor-install              Install Tor into the data directory',
        '  tor-info                 Print Tor install/running info',
        '',
        'Flags:',
        '  --data-dir PATH          Base data directory (default: XDG_STATE_HOME/guncelium or ~/.local/state/guncelium)',
        '  --gun-host HOST          Gun TCP listen host (default: 127.0.0.1)',
        '  --gun-port PORT          Gun TCP listen port (default: 0, random)',
        '  --tor                    Enable Tor + hidden service for Gun TCP',
        '  --clean-slate            Reset Tor state/HS config before start (default: true; set --clean-slate=false to preserve)',
        '  --hs-key KEY             Hidden service key name (optional)',
        '  --virtual-port PORT      Onion virtual port (default: 8888)',
        '',
        'Examples:',
        '  guncelium service --tor',
        '  guncelium tor-install',
    ].join('\n'));
}

function createNodeAppShimOrThrow(userDataDir) {
    requireString(userDataDir, 'userDataDir');
    return {
        getPath: (name) => {
            if (name !== 'userData') throw new Error(`unsupported getPath(${name})`);
            return userDataDir;
        },
    };
}

async function torInstallOrThrow(app) {
    // eslint-disable-next-line global-require
    const { installTor } = require('../../../modules/guncelium-tor/main/service/installer');
    const r = await installTor({ app, version: undefined });
    if (!r || r.ok !== true) throw new Error(`tor install failed: ${JSON.stringify(r)}`);
    return r;
}

async function torInfoOrThrow(app, torChild) {
    // eslint-disable-next-line global-require
    const { getTorInfo } = require('../../../modules/guncelium-tor/main/service/info');
    const info = await getTorInfo({ app, torChild });
    requireObject(info, 'tor info');
    return info;
}

async function torStartOrThrow(app, state, flags) {
    // eslint-disable-next-line global-require
    const { getTorPaths } = require('../../../modules/guncelium-tor/main/service/paths');
    // eslint-disable-next-line global-require
    const { getTorInfo } = require('../../../modules/guncelium-tor/main/service/info');
    // eslint-disable-next-line global-require
    const { isPortFree } = require('../../../modules/guncelium-tor/main/service/netUtil');
    // eslint-disable-next-line global-require
    const { ensureMinimalTorrc, writeMinimalTorrc, sanitizeTorrc, cleanupHiddenServices } = require('../../../modules/guncelium-tor/main/service/torrcUtil');
    // eslint-disable-next-line global-require
    const { startTorProcess } = require('../../../modules/guncelium-tor/main/service/process');
    // eslint-disable-next-line global-require
    const { stopProcessGracefully } = require('../../../modules/guncelium-tor/main/service/procUtil');
    // eslint-disable-next-line global-require
    const { controlPortProtocolInfo } = require('../../../modules/guncelium-tor/main/service/controlPort');

    if (state.torChild && !state.torChild.killed) throw new Error('tor already running');

    const info = await getTorInfo({ app, torChild: state.torChild });
    if (!info || !info.installed) throw new Error('tor not installed (run: guncelium tor-install)');
    if (!info.path) throw new Error('tor binary not found');

    const { torrcPath, dataDir, hsBaseDir, hiddenServicesResultsFile } = getTorPaths(app);

    // Clean slate default (deterministic).
    const cleanSlate = flags['clean-slate'] === undefined ? true : (flags['clean-slate'] === true);
    if (cleanSlate) {
        cleanupHiddenServices({ hsBaseDir, hiddenServicesResultsFile });
        writeMinimalTorrc({ torrcPath, dataDir });
    } else {
        ensureMinimalTorrc({ torrcPath, dataDir });
        sanitizeTorrc({ torrcPath, dataDir });
    }

    const controlHost = '127.0.0.1';
    const controlPort = 9051;
    let free = false;
    for (let i = 0; i < 15; i++) {
        // eslint-disable-next-line no-await-in-loop
        free = await isPortFree(controlHost, controlPort);
        if (free) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 150));
    }
    if (!free) throw new Error('ControlPort 9051 is not available');

    const args = ['-f', torrcPath, '--ControlPort', `${controlHost}:${controlPort}`, '--CookieAuthentication', '1'];
    const proc = startTorProcess({ app, torPath: info.path, args });
    if (!proc || !proc.child) throw new Error('startTorProcess failed');

    state.torChild = proc.child;
    state.controlPort = controlPort;

    const exitedQuickly = await new Promise((resolve) => {
        let settled = false;
        const t = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(false);
        }, 800);
        proc.child.once('exit', () => {
            if (settled) return;
            settled = true;
            clearTimeout(t);
            resolve(true);
        });
    });

    if (exitedQuickly) {
        await stopProcessGracefully({ child: proc.child, timeoutMs: 2500 });
        state.torChild = null;
        throw new Error('tor exited immediately');
    }

    let controlOk = false;
    for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        const r = await controlPortProtocolInfo(controlHost, controlPort, 300);
        if (r && r.ok) { controlOk = true; break; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r2 => setTimeout(r2, 150));
    }
    if (!controlOk) {
        await stopProcessGracefully({ child: proc.child, timeoutMs: 2500 });
        state.torChild = null;
        throw new Error('ControlPort did not become ready');
    }

    return { pid: proc.child.pid, controlPort };
}

async function torHiddenServiceOrThrow(app, localPort, flags) {
    // eslint-disable-next-line global-require
    const { createHiddenServices, readHiddenServicesStatus } = require('../../../modules/guncelium-tor/main/service/hiddenServices');

    const virtualPort = flags['virtual-port'] === undefined ? 8888 : requireInteger(flags['virtual-port'], '--virtual-port');
    if (virtualPort < 1 || virtualPort > 65535) throw new Error('--virtual-port must be 1..65535');

    const keys = [];
    if (flags['hs-key'] !== undefined && flags['hs-key'] !== true) {
        keys.push(String(flags['hs-key']));
    }

    const created = await createHiddenServices({
        app,
        keys,
        localPort,
        virtualPort,
        serviceName: 'gun-tcp',
        enableControlPort: true,
    });
    requireObject(created, 'hidden service create');
    if (created.ok !== true) throw new Error(`hidden service create failed: ${JSON.stringify(created)}`);

    const status = await readHiddenServicesStatus({ app, controlPortHost: '127.0.0.1', controlPortPort: 9051 });
    requireObject(status, 'hidden service status');
    return status;
}

async function runServiceOrThrow(app, flags) {
    // eslint-disable-next-line global-require
    const { createGunTcpMeshControllerOrThrow } = require('../../../modules/guncelium-gun/main/index.js');

    const gunHost = flags['gun-host'] === undefined ? '127.0.0.1' : String(flags['gun-host']);
    requireString(gunHost, '--gun-host');

    const gunPort = flags['gun-port'] === undefined ? 0 : requireInteger(flags['gun-port'], '--gun-port');
    if (gunPort < 0 || gunPort > 65535) throw new Error('--gun-port must be 0..65535');

    const gunTcp = createGunTcpMeshControllerOrThrow({ electronApp: app });
    const started = await gunTcp.startTcp({ host: gunHost, port: gunPort, peers: [] });
    requireObject(started, 'gun tcp started');
    if (started.ok !== true || started.running !== true || !started.port) throw new Error(`gun tcp start failed: ${JSON.stringify(started)}`);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, gunTcp: { host: gunHost, port: started.port } }));

    const torState = { torChild: null, controlPort: null };
    if (flags.tor === true) {
        const torStarted = await torStartOrThrow(app, torState, flags);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, tor: torStarted }));

        const hsStatus = await torHiddenServiceOrThrow(app, started.port, flags);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true, hiddenServices: hsStatus }));
    }

    const stopAllOrThrow = async () => {
        try {
            await gunTcp.stopTcp();
        } catch (e) {
            throw e;
        }
        if (torState.torChild) {
            // eslint-disable-next-line global-require
            const { stopProcessGracefully } = require('../../../modules/guncelium-tor/main/service/procUtil');
            await stopProcessGracefully({ child: torState.torChild, timeoutMs: 2500 });
            torState.torChild = null;
        }
    };

    await new Promise((resolve) => {
        const done = async (sig) => {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({ ok: true, stopping: true, signal: sig }));
            await stopAllOrThrow();
            resolve();
        };
        process.once('SIGINT', () => { done('SIGINT').catch((e) => { throw e; }); });
        process.once('SIGTERM', () => { done('SIGTERM').catch((e) => { throw e; }); });
    });
}

async function setup(imports, register) {
    requireObject(imports, 'imports');
    requireObject(imports.args, 'imports.args');
    requireObject(imports.app, 'imports.app');
    if (typeof register !== 'function') throw new Error('register must be a function');

    const { command, flags } = imports.args;
    requireString(command, 'command');
    requireObject(flags, 'flags');

    if (command === 'help') {
        printHelp();
        process.exit(0);
    }

    const userDataDir = resolveUserDataDirOrThrow(flags);
    const app = createNodeAppShimOrThrow(userDataDir);

    if (command === 'tor-install') {
        const r = await torInstallOrThrow(app);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(r));
        process.exit(0);
    }

    if (command === 'tor-info') {
        const info = await torInfoOrThrow(app, null);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(info));
        process.exit(0);
    }

    if (command === 'service') {
        await runServiceOrThrow(app, flags);
        process.exit(0);
    }

    throw new Error(`unknown command: ${command}`);
}

module.exports = setup;
