'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

function requireInt(value, name, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be int ${min}..${max}`);
    return n;
}

const MAX_WAIT_MS = 6 * 60 * 60 * 1000; // 6 hours (bounded)

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

async function mainOrThrow() {
    const child = spawn(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['expo', 'run:android'],
        {
            stdio: ['inherit', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env: { ...process.env },
        },
    );

    assert(child && typeof child.pid === 'number', 'failed to spawn expo run:android');

    const rlOut = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });

    let done = false;
    let desiredExitCode = null;

    const onLine = async (line, isErr) => {
        const s = String(line);
        if (isErr) process.stderr.write(`${s}\n`);
        else process.stdout.write(`${s}\n`);

        if (done) return;
        const parsed = parseMonikerCompleteOrNull(s);
        if (!parsed) return;

        done = true;
        desiredExitCode = parsed.failed > 0 ? 1 : 0;

        try {
            await stopChildOrThrow(child);
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            throw new Error(`Moniker complete detected, but failed to stop expo process: ${msg}`);
        }

        process.exit(desiredExitCode);
    };

    rlOut.on('line', (line) => {
        onLine(line, false).catch((e) => {
            const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
            // eslint-disable-next-line no-console
            console.error(msg);
            process.exit(2);
        });
    });
    rlErr.on('line', (line) => {
        onLine(line, true).catch((e) => {
            const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
            // eslint-disable-next-line no-console
            console.error(msg);
            process.exit(2);
        });
    });

    const { code, signal } = await waitForExitOrThrow(child, MAX_WAIT_MS);

    if (desiredExitCode !== null) process.exit(desiredExitCode);

    // Child exited without emitting Moniker completion.
    throw new Error(`expo run:android exited early (code=${String(code)} signal=${String(signal)}) before Moniker completion`);
}

mainOrThrow().catch((e) => {
    const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exit(2);
});
