'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function requireInt(value, name, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be int ${min}..${max}`);
    return n;
}

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
    const t = requireInt(timeoutMs, 'timeoutMs', 1, MAX_WAIT_MS);
    const res = spawnSync('adb', args, { encoding: 'utf8', timeout: t });
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
        // Format: <serial>\tdevice ...
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

function parseMonikerCompleteOrNull(line) {
    const s = String(line || '');
    const m = s.match(/\[Moniker\]\s+TEST COMPLETE\s*\|\s*Passed:\s*(\d+)\s+Failed:\s*(\d+)/);
    if (!m) return null;
    return {
        passed: requireInt(m[1], 'passed', 0, 1000000),
        failed: requireInt(m[2], 'failed', 0, 1000000),
    };
}

function killProcessGroupOrThrow(child, signal) {
    assert(child && typeof child.pid === 'number', 'child.pid required');
    assert(typeof signal === 'string' && signal.length > 0, 'signal required');

    if (process.platform === 'win32') {
        const ok = child.kill(signal);
        if (!ok) throw new Error(`failed to send ${signal} to child`);
        return;
    }

    // On POSIX, prefer killing the whole process group.
    try {
        process.kill(-child.pid, signal);
    } catch (e) {
        const ok = child.kill(signal);
        if (!ok) throw new Error(`failed to send ${signal} to child: ${e && e.message ? e.message : String(e)}`);
    }
}

async function waitForExitOrThrow(child, timeoutMs) {
    assert(child && typeof child.pid === 'number', 'child.pid required');
    const t = requireInt(timeoutMs, 'timeoutMs', 1, MAX_WAIT_MS);

    return await new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`timeout waiting for child exit (${String(t)}ms)`));
        }, t);

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

    // SIGINT first, like Ctrl+C.
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

    // Then SIGTERM.
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

    // Finally SIGKILL.
    try {
        killProcessGroupOrThrow(child, 'SIGKILL');
    } catch (e) {
        throw new Error(`failed to SIGKILL child: ${e && e.message ? e.message : String(e)}`);
    }

    await waitForExitOrThrow(child, 10000);
}

function spawnExpoOrThrow(args) {
    assert(Array.isArray(args), 'args must be array');
    const child = spawn(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['expo', ...args],
        {
            stdio: ['inherit', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env: { ...process.env },
        },
    );
    assert(child && typeof child.pid === 'number', 'failed to spawn expo process');
    return child;
}

function pumpLinesOrThrow(child, onLine) {
    assert(child && typeof child.pid === 'number', 'child required');
    assert(typeof onLine === 'function', 'onLine required');

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
    // Ensure the app cold-starts so it reloads reliably.
    const androidPackage = getAndroidPackageOrThrow();
    const serial = pickAdbSerialOrThrow();
    adbForceStopOrThrow(serial, androidPackage);

    // IMPORTANT: we need to own the log stream that prints Moniker output.
    // Use expo start (bundler) and launch Android from it.
    const bundler = spawnExpoOrThrow(['start', '--dev-client', '--android', '--port', String(EXPO_PORT)]);

    let done = false;
    let desiredExitCode = null;

    const onLine = async (line, isErr) => {
        const s = String(line);
        if (isErr) process.stderr.write(`${s}\n`);
        else process.stdout.write(`${s}\n`);

        if (!done && s.includes('CommandError:')) {
            done = true;
            try { await stopChildOrThrow(bundler); } catch (_e0) { }
            throw new Error(`expo command failed: ${s}`);
        }

        if (!done && s.includes('Port ') && s.includes('is running this app in another window')) {
            done = true;
            try { await stopChildOrThrow(bundler); } catch (_e0) { }
            throw new Error(`unexpected port collision even after preflight; choose a different base port list or stop the other Expo process: ${s}`);
        }

        if (done) return;
        const parsed = parseMonikerCompleteOrNull(s);
        if (!parsed) return;

        done = true;
        desiredExitCode = parsed.failed > 0 ? 1 : 0;

        try {
            await stopChildOrThrow(bundler);
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            throw new Error(`Moniker complete detected, but failed to stop expo bundler: ${msg}`);
        }

        process.exit(desiredExitCode);
    };

    pumpLinesOrThrow(bundler, onLine);

    const { code, signal } = await waitForExitOrThrow(bundler, MAX_WAIT_MS);
    if (desiredExitCode !== null) process.exit(desiredExitCode);
    throw new Error(`expo bundler exited early (code=${String(code)} signal=${String(signal)}) before Moniker completion`);
}

mainOrThrow().catch((e) => {
    const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exit(2);
});
