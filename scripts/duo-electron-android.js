'use strict';

const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const MAX_WAIT_MS = 6 * 60 * 60 * 1000; // 6 hours (bounded)
const MAX_ADB_MS = 15000;
const EXPO_PORT = 8081;
const DUO_COORD_PORT = 45820;

function requireInt(value, name, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be int ${min}..${max}`);
    return n;
}

function readJsonFileOrThrow(filePath) {
    assert(typeof filePath === 'string' && filePath.length > 0, 'filePath required');
    const raw = fs.readFileSync(filePath, { encoding: 'utf8' });
    assert(typeof raw === 'string' && raw.length > 0, 'file content required');
    return JSON.parse(raw);
}

function getAndroidPackageOrThrow() {
    const override = process.env.GUNCELIUM_ANDROID_PACKAGE;
    if (typeof override === 'string' && override.length > 0) return override;

    const appJsonPath = path.join(process.cwd(), 'app.json');
    const appJson = readJsonFileOrThrow(appJsonPath);

    const pkg = appJson
        && appJson.expo
        && appJson.expo.android
        && appJson.expo.android.package;

    assert(typeof pkg === 'string' && pkg.length > 0, 'expo.android.package missing in app.json');
    return pkg;
}

function runAdbOrThrow(args, timeoutMs) {
    assert(Array.isArray(args) && args.length > 0, 'adb args required');
    assert(typeof timeoutMs === 'number' && timeoutMs > 0, 'timeoutMs required');

    const res = spawnSync('adb', args, { encoding: 'utf8', timeout: timeoutMs });
    assert(res && typeof res.status === 'number', 'adb did not return a status');
    if (res.error) throw res.error;
    if (res.status !== 0) {
        const out = String(res.stdout || '').trim();
        const err = String(res.stderr || '').trim();
        throw new Error(`adb ${args.join(' ')} failed (status=${String(res.status)}): ${err || out}`);
    }
    return { stdout: String(res.stdout || ''), stderr: String(res.stderr || '') };
}

function runAdbAllowStatusOrThrow(args, timeoutMs, allowedStatuses) {
    assert(Array.isArray(args) && args.length > 0, 'adb args required');
    assert(typeof timeoutMs === 'number' && timeoutMs > 0, 'timeoutMs required');
    assert(Array.isArray(allowedStatuses) && allowedStatuses.length > 0, 'allowedStatuses required');

    const res = spawnSync('adb', args, { encoding: 'utf8', timeout: timeoutMs });
    assert(res && typeof res.status === 'number', 'adb did not return a status');
    if (res.error) throw res.error;

    const status = Number(res.status);
    if (!allowedStatuses.includes(status)) {
        const out = String(res.stdout || '').trim();
        const err = String(res.stderr || '').trim();
        throw new Error(`adb ${args.join(' ')} failed (status=${String(status)}): ${err || out}`);
    }

    return { status, stdout: String(res.stdout || ''), stderr: String(res.stderr || '') };
}

function pickAdbSerialOrThrow() {
    const envSerial = process.env.ANDROID_SERIAL || process.env.GUNCELIUM_ANDROID_SERIAL;
    if (typeof envSerial === 'string' && envSerial.length > 0) return envSerial;

    const { stdout } = runAdbOrThrow(['devices', '-l'], MAX_ADB_MS);
    const lines = String(stdout).split(/\r?\n/);
    const serials = [];
    for (let i = 0; i < lines.length; i++) {
        const line = String(lines[i]).trim();
        if (!line || line.startsWith('List of devices attached')) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;
        if (parts[1] !== 'device') continue;
        serials.push(parts[0]);
    }

    if (serials.length === 0) throw new Error('no adb devices detected (connect/emulator and ensure adb works)');
    if (serials.length !== 1) throw new Error(`multiple adb devices detected; set ANDROID_SERIAL to one of: ${serials.join(', ')}`);
    return serials[0];
}

function adbForceStopOrThrow(serial, androidPackage) {
    assert(typeof serial === 'string' && serial.length > 0, 'serial required');
    assert(typeof androidPackage === 'string' && androidPackage.length > 0, 'androidPackage required');
    runAdbOrThrow(['-s', serial, 'shell', 'am', 'force-stop', androidPackage], MAX_ADB_MS);
}

function adbKillByPidofOrThrow(serial, androidPackage) {
    assert(typeof serial === 'string' && serial.length > 0, 'serial required');
    assert(typeof androidPackage === 'string' && androidPackage.length > 0, 'androidPackage required');

    // pidof returns exit status 1 when the process is not running.
    const r = runAdbAllowStatusOrThrow(['-s', serial, 'shell', 'pidof', androidPackage], MAX_ADB_MS, [0, 1]);
    const out = String(r.stdout || '').trim();
    if (!out) return; // already not running

    const parts = out.split(/\s+/).filter(Boolean);
    if (parts.length < 1 || parts.length > 20) throw new Error(`unexpected pidof pid count: ${String(parts.length)}`);

    for (let i = 0; i < parts.length; i++) {
        const pid = Number(parts[i]);
        if (!Number.isInteger(pid) || pid < 1) throw new Error(`invalid pid from pidof: ${parts[i]}`);
    }

    // One kill invocation for all pids (bounded by 20).
    runAdbOrThrow(['-s', serial, 'shell', 'kill', '-9', ...parts], MAX_ADB_MS);
}

function adbLaunchOrThrow(serial, androidPackage) {
    assert(typeof serial === 'string' && serial.length > 0, 'serial required');
    assert(typeof androidPackage === 'string' && androidPackage.length > 0, 'androidPackage required');
    runAdbOrThrow(['-s', serial, 'shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1'], MAX_ADB_MS);
}

function adbOpenDeepLinkOrThrow(serial, androidPackage, url) {
    assert(typeof serial === 'string' && serial.length > 0, 'serial required');
    assert(typeof androidPackage === 'string' && androidPackage.length > 0, 'androidPackage required');
    assert(typeof url === 'string' && url.length > 0, 'url required');

    const activity = `${androidPackage}/.MainActivity`;
    runAdbOrThrow(
        ['-s', serial, 'shell', 'am', 'start', '-n', activity, '-a', 'android.intent.action.VIEW', '-d', url],
        MAX_ADB_MS,
    );
}

function parseReversePortsOrThrow() {
    const raw = process.env.GUNCELIUM_ADB_REVERSE_PORTS;
    const fallback = [EXPO_PORT, DUO_COORD_PORT];
    if (raw === undefined || raw === null || String(raw).trim().length === 0) return fallback;

    const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 1 || parts.length > 10) throw new Error('GUNCELIUM_ADB_REVERSE_PORTS must contain 1..10 comma-separated ports');

    const ports = [];
    for (let i = 0; i < parts.length; i++) {
        const n = Number(parts[i]);
        if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid reverse port: ${parts[i]}`);
        if (!ports.includes(n)) ports.push(n);
    }

    if (ports.length < 1) throw new Error('no reverse ports after parsing');
    return ports;
}

function startDuoCoordinatorOrThrow() {
    // eslint-disable-next-line global-require
    const http = require('node:http');
    // eslint-disable-next-line global-require
    const { Server } = require('socket.io');

    const httpServer = http.createServer();
    const io = new Server(httpServer, {
        serveClient: false,
        cors: { origin: '*' },
        transports: ['websocket', 'polling'],
    });

    const state = {
        electron: null,
        android: null,
        exchangeParams: null,
        aligned: { electron: false, android: false },
        data: { electron: null, android: null },
    };

    io.on('connection', (socket) => {
        socket.on('register', (payload, ack) => {
            try {
                if (!payload || typeof payload !== 'object') throw new Error('register payload must be object');
                const role = String(payload.role || '').trim().toLowerCase();
                if (role !== 'electron' && role !== 'android') throw new Error('role must be electron|android');

                if (role === 'electron') state.electron = socket;
                if (role === 'android') state.android = socket;

                if (state.android && state.electron) {
                    state.electron.emit('peerConnected', { role: 'android' });
                    state.android.emit('peerConnected', { role: 'electron' });
                }

                if (role === 'android' && state.exchangeParams) {
                    state.android.emit('exchangeParams', state.exchangeParams);
                }

                // Include params in the ack to avoid a race where the event is emitted
                // before the client has attached its `exchangeParams` listener.
                const ackPayload = { ok: true, role };
                if (role === 'android' && state.exchangeParams) {
                    ackPayload.exchangeParams = state.exchangeParams;
                }

                if (typeof ack === 'function') ack(ackPayload);
            } catch (e) {
                if (typeof ack === 'function') ack({ ok: false, error: e && e.message ? e.message : String(e) });
            }
        });

        socket.on('exchangeParams', (payload, ack) => {
            try {
                if (!payload || typeof payload !== 'object') throw new Error('exchangeParams payload must be object');
                const onionHost = String(payload.onionHost || '').trim();
                const runId = String(payload.runId || '').trim();
                const port = Number(payload.port);
                if (!onionHost.toLowerCase().endsWith('.onion')) throw new Error('onionHost must end with .onion');
                if (!runId) throw new Error('runId required');
                if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1..65535');

                state.exchangeParams = { onionHost, port, runId };
                if (state.android) state.android.emit('exchangeParams', state.exchangeParams);
                if (typeof ack === 'function') ack({ ok: true });
            } catch (e) {
                if (typeof ack === 'function') ack({ ok: false, error: e && e.message ? e.message : String(e) });
            }
        });

        socket.on('androidReady', (payload, ack) => {
            try {
                if (state.electron) state.electron.emit('androidReady', payload || { ok: true });
                if (typeof ack === 'function') ack({ ok: true });
            } catch (e) {
                if (typeof ack === 'function') ack({ ok: false, error: e && e.message ? e.message : String(e) });
            }
        });

        socket.on('duoAligned', (payload, ack) => {
            try {
                if (!payload || typeof payload !== 'object') throw new Error('duoAligned payload must be object');
                const role = String(payload.role || '').trim().toLowerCase();
                if (role !== 'electron' && role !== 'android') throw new Error('role must be electron|android');
                state.aligned[role] = true;

                if (state.aligned.electron && state.aligned.android) {
                    if (state.electron) state.electron.emit('duoAligned', { ok: true });
                    if (state.android) state.android.emit('duoAligned', { ok: true });
                }

                if (typeof ack === 'function') ack({ ok: true });
            } catch (e) {
                if (typeof ack === 'function') ack({ ok: false, error: e && e.message ? e.message : String(e) });
            }
        });

        socket.on('duoData', (payload, ack) => {
            try {
                if (!payload || typeof payload !== 'object') throw new Error('duoData payload must be object');
                const role = String(payload.role || '').trim().toLowerCase();
                if (role !== 'electron' && role !== 'android') throw new Error('role must be electron|android');
                const value = String(payload.value || '').trim();
                if (!value) throw new Error('value must be non-empty');
                if (value.length > 512) throw new Error('value too long (max 512)');

                state.data[role] = { role, value };

                const bothReady = !!(state.data.electron && state.data.android);
                const both = bothReady ? { ok: true, electron: state.data.electron, android: state.data.android } : null;

                if (bothReady) {
                    if (state.electron) state.electron.emit('duoData', both);
                    if (state.android) state.android.emit('duoData', both);
                }

                if (typeof ack === 'function') ack(both ? { ok: true, both } : { ok: true });
            } catch (e) {
                if (typeof ack === 'function') ack({ ok: false, error: e && e.message ? e.message : String(e) });
            }
        });
    });

    httpServer.listen(DUO_COORD_PORT, '127.0.0.1');
    return {
        port: DUO_COORD_PORT,
        close: async () => {
            await new Promise((resolve, reject) => {
                io.close();
                httpServer.close((err) => (err ? reject(err) : resolve()));
            });
        },
    };
}

function adbReversePortsOrThrow(serial, ports) {
    assert(typeof serial === 'string' && serial.length > 0, 'serial required');
    assert(Array.isArray(ports) && ports.length > 0, 'ports required');

    for (let i = 0; i < ports.length; i++) {
        const p = ports[i];
        assert(Number.isInteger(p) && p > 0 && p < 65536, 'port int required');
        runAdbOrThrow(['-s', serial, 'reverse', `tcp:${String(p)}`, `tcp:${String(p)}`], MAX_ADB_MS);
    }
}

function killProcessGroupOrThrow(child, signal) {
    assert(child && typeof child.pid === 'number', 'child.pid required');
    assert(typeof signal === 'string' && signal.length > 0, 'signal required');

    if (process.platform === 'win32') {
        const ok = child.kill(signal);
        if (!ok) throw new Error(`failed to send ${signal} to child`);
        return;
    }

    try {
        process.kill(-child.pid, signal);
    } catch (e) {
        const ok = child.kill(signal);
        if (!ok) throw new Error(`failed to send ${signal} to child: ${e && e.message ? e.message : String(e)}`);
    }
}

async function waitForExitOrThrow(child, timeoutMs) {
    assert(child && typeof child.pid === 'number', 'child.pid required');
    assert(typeof timeoutMs === 'number' && timeoutMs > 0, 'timeoutMs required');

    return await new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`timeout waiting for child exit (${String(timeoutMs)}ms)`));
        }, timeoutMs);

        child.once('exit', (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code, signal });
        });

        child.once('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(e);
        });
    });
}

async function stopChildOrThrow(child) {
    assert(child && typeof child.pid === 'number', 'child.pid required');

    try {
        killProcessGroupOrThrow(child, 'SIGINT');
    } catch (e) {
        throw new Error(`failed to SIGINT child: ${e && e.message ? e.message : String(e)}`);
    }

    try {
        await waitForExitOrThrow(child, 10000);
        return;
    } catch (_e0) {
        // continue
    }

    try {
        killProcessGroupOrThrow(child, 'SIGTERM');
    } catch (e) {
        throw new Error(`failed to SIGTERM child: ${e && e.message ? e.message : String(e)}`);
    }

    try {
        await waitForExitOrThrow(child, 10000);
        return;
    } catch (_e1) {
        // continue
    }

    try {
        killProcessGroupOrThrow(child, 'SIGKILL');
    } catch (e) {
        throw new Error(`failed to SIGKILL child: ${e && e.message ? e.message : String(e)}`);
    }

    await waitForExitOrThrow(child, 10000);
}

function spawnElectronStartOrThrow() {
    const child = spawn(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', 'electron:start'],
        {
            stdio: ['inherit', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env: {
                ...process.env,
                // Keep electron alive even if Moniker completes.
                GUNCELIUM_AUTO_EXIT_ON_TEST_COMPLETE: '0',
                GUNCELIUM_DUO: '1',
                GUNCELIUM_DUO_COORD_PORT: String(DUO_COORD_PORT),
                // Ensure Electron renderer points at the same Metro port.
                EXPO_WEB_URL: `http://localhost:${String(EXPO_PORT)}`,
            },
        },
    );
    assert(child && typeof child.pid === 'number', 'failed to spawn electron:start');
    return child;
}

function isExpoReadyLine(line) {
    const s = String(line || '');
    if (!s) return false;
    if (s.includes('Metro waiting on') && s.includes(String(EXPO_PORT))) return true;
    if (s.includes('Waiting on') && s.includes(`http://localhost:${String(EXPO_PORT)}`)) return true;
    if (s.includes(`http://localhost:${String(EXPO_PORT)}`)) return true;
    return false;
}

function parseMonikerCompleteOrNull(line) {
    const s = String(line || '');
    const m = s.match(/\[Moniker\]\s+TEST COMPLETE\s*\|\s*Passed:\s*(\d+)\s+Failed:\s*(\d+)/);
    if (!m) return null;
    return {
        passed: requireInt(m[1], 'passed', 0, 1000000),
        failed: requireInt(m[2], 'failed', 0, 1000000),
    };
}

function pumpElectronLinesOrThrow(child, onLine) {
    assert(child && typeof child.pid === 'number', 'child required');
    assert(typeof onLine === 'function', 'onLine required');
    assert(child.stdout, 'child.stdout required');
    assert(child.stderr, 'child.stderr required');

    const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });

    rlOut.on('line', (line) => {
        onLine(String(line), false).catch((e) => {
            const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
            // eslint-disable-next-line no-console
            console.error(msg);
            process.exit(2);
        });
    });

    rlErr.on('line', (line) => {
        onLine(String(line), true).catch((e) => {
            const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
            // eslint-disable-next-line no-console
            console.error(msg);
            process.exit(2);
        });
    });
}

async function mainOrThrow() {
    const serial = pickAdbSerialOrThrow();
    const androidPackage = getAndroidPackageOrThrow();
    const reversePorts = parseReversePortsOrThrow();

    const coord = startDuoCoordinatorOrThrow();

    // Start Electron (which should also bring up Metro via expo-electron).
    const electron = spawnElectronStartOrThrow();

    let expoReady = false;
    let monikerCompleteCount = 0;
    let monikerFailedAny = false;
    let monikerA = null;
    let monikerB = null;
    let duoDone = false;
    let desiredExitCode = null;

    let expoPreparedAndroid = false;
    let androidLaunched = false;

    let completeResolve = null;
    const completionPromise = new Promise((resolve) => {
        completeResolve = resolve;
    });
    assert(typeof completeResolve === 'function', 'completionPromise resolver missing');

    let stopping = false;
    const cleanupOrThrow = async () => {
        if (stopping) return;
        stopping = true;
        await stopChildOrThrow(electron);
        await coord.close();
    };

    process.on('SIGINT', () => {
        cleanupOrThrow().catch((e) => {
            // eslint-disable-next-line no-console
            console.error('cleanup failed', e);
            process.exit(2);
        });
    });

    const onElectronLine = async (line, isErr) => {
        const s = String(line);
        if (isErr) process.stderr.write(`${s}\n`);
        else process.stdout.write(`${s}\n`);

        if (!expoReady && isExpoReadyLine(s)) {
            expoReady = true;
            // Ensure device/emulator can reach host Metro via localhost.
            adbReversePortsOrThrow(serial, reversePorts);

            // Prepare Android (stop/kill) only after Metro is reachable.
            adbForceStopOrThrow(serial, androidPackage);
            adbKillByPidofOrThrow(serial, androidPackage);
            expoPreparedAndroid = true;
        }

        if (expoPreparedAndroid && !androidLaunched) {
            androidLaunched = true;
            // Fixed deep link indicates “duo mode”; exchange params are delivered via socket.io.
            adbOpenDeepLinkOrThrow(serial, androidPackage, 'guncelium://e2e/duo/v1');
        }

        const parsed = parseMonikerCompleteOrNull(s);
        if (!parsed) return;

        monikerCompleteCount += 1;
        if (parsed.failed > 0) monikerFailedAny = true;
        if (monikerA === null) monikerA = parsed;
        else if (monikerB === null) monikerB = parsed;
        else throw new Error('received more than 2 Moniker TEST COMPLETE events (unexpected)');

        if (monikerCompleteCount >= 2) {
            // eslint-disable-next-line no-console
            console.log(`[duo] both Moniker runs complete: A=${JSON.stringify(monikerA)} B=${JSON.stringify(monikerB)}`);
            duoDone = true;
            desiredExitCode = monikerFailedAny ? 1 : 0;
            completeResolve({ exitCode: desiredExitCode });
        }
    };

    pumpElectronLinesOrThrow(electron, onElectronLine);

    const winner = await Promise.race([
        completionPromise,
        waitForExitOrThrow(electron, MAX_WAIT_MS).then(({ code, signal }) => {
            throw new Error(`electron exited before duo completion (code=${String(code)} signal=${String(signal)})`);
        }),
    ]);

    if (!winner || typeof winner !== 'object' || typeof winner.exitCode !== 'number') throw new Error('duo completion resolved with invalid value');
    if (duoDone !== true || desiredExitCode === null) throw new Error('duo completion state inconsistent');

    await cleanupOrThrow();
    process.exit(winner.exitCode);
}

if (require.main === module) {
    mainOrThrow().catch((e) => {
        const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
        // eslint-disable-next-line no-console
        console.error(msg);
        process.exit(2);
    });
}
