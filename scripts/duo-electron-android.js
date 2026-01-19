'use strict';

const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const MAX_WAIT_MS = 6 * 60 * 60 * 1000; // 6 hours (bounded)
const MAX_ADB_MS = 15000;
const EXPO_PORT = 8081;

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

function adbLaunchOrThrow(serial, androidPackage) {
    assert(typeof serial === 'string' && serial.length > 0, 'serial required');
    assert(typeof androidPackage === 'string' && androidPackage.length > 0, 'androidPackage required');
    runAdbOrThrow(['-s', serial, 'shell', 'monkey', '-p', androidPackage, '-c', 'android.intent.category.LAUNCHER', '1'], MAX_ADB_MS);
}

function parseReversePortsOrThrow() {
    const raw = process.env.GUNCELIUM_ADB_REVERSE_PORTS;
    const fallback = [EXPO_PORT];
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

async function waitForExpoReadyOrThrow(child) {
    assert(child && typeof child.pid === 'number', 'child.pid required');

    let ready = false;

    const onLine = async (line, isErr) => {
        const s = String(line);
        if (isErr) process.stderr.write(`${s}\n`);
        else process.stdout.write(`${s}\n`);
        if (!ready && isExpoReadyLine(s)) ready = true;
    };

    const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });

    rlOut.on('line', (line) => { onLine(line, false).catch((e) => { throw e; }); });
    rlErr.on('line', (line) => { onLine(line, true).catch((e) => { throw e; }); });

    const maxSteps = Math.floor(MAX_WAIT_MS / 250);
    for (let i = 0; i < maxSteps; i++) {
        if (ready) return;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`timeout waiting for Metro on :${String(EXPO_PORT)}`);
}

async function mainOrThrow() {
    const serial = pickAdbSerialOrThrow();
    const androidPackage = getAndroidPackageOrThrow();
    const reversePorts = parseReversePortsOrThrow();

    // Start Electron (which should also bring up Metro via expo-electron).
    const electron = spawnElectronStartOrThrow();

    let stopping = false;
    const cleanupOrThrow = async () => {
        if (stopping) return;
        stopping = true;
        await stopChildOrThrow(electron);
    };

    process.on('SIGINT', () => {
        cleanupOrThrow().catch((e) => {
            // eslint-disable-next-line no-console
            console.error('cleanup failed', e);
            process.exit(2);
        });
    });

    await waitForExpoReadyOrThrow(electron);

    // Ensure device/emulator can reach host Metro via localhost.
    adbReversePortsOrThrow(serial, reversePorts);

    // Now launch Android on-demand.
    adbForceStopOrThrow(serial, androidPackage);
    adbLaunchOrThrow(serial, androidPackage);

    // Keep running until Electron exits or user interrupts.
    const { code, signal } = await waitForExitOrThrow(electron, MAX_WAIT_MS);
    throw new Error(`electron exited (code=${String(code)} signal=${String(signal)})`);
}

if (require.main === module) {
    mainOrThrow().catch((e) => {
        const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
        // eslint-disable-next-line no-console
        console.error(msg);
        process.exit(2);
    });
}
