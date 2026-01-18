'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const net = require('node:net');
const readline = require('node:readline');

function requireInt(value, name, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be int ${min}..${max}`);
    return n;
}

const MAX_WAIT_MS = 6 * 60 * 60 * 1000; // 6 hours (bounded)

async function isPortFreeOrThrow(port) {
    const p = requireInt(port, 'port', 1, 65535);
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', (e) => {
            const code = e && e.code ? String(e.code) : '';
            if (code === 'EADDRINUSE' || code === 'EACCES') {
                resolve(false);
                return;
            }
            reject(e);
        });
        server.once('listening', () => {
            server.close((err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
        server.listen({ host: '127.0.0.1', port: p });
    });
}

async function pickPortOrThrow(ports) {
    assert(Array.isArray(ports) && ports.length > 0, 'ports must be a non-empty array');
    for (let i = 0; i < ports.length; i++) {
        const p = requireInt(ports[i], `ports[${i}]`, 1, 65535);
        // eslint-disable-next-line no-await-in-loop
        const free = await isPortFreeOrThrow(p);
        if (free) return p;
    }
    throw new Error('no free port found in fixed port list');
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
    // IMPORTANT: we need to own the log stream that prints Moniker output.
    // Use expo start (bundler) and launch Android from it.
    const port = await pickPortOrThrow([8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090, 8091]);
    const bundler = spawnExpoOrThrow(['start', '--dev-client', '--android', '--port', String(port)]);

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
