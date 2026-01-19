'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function ensureParentDirOrThrow(filePath) {
    requireString(filePath, 'filePath');
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
        const st = fs.statSync(dir);
        if (!st.isDirectory()) throw new Error(`expected directory at ${dir}`);
        return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const st = fs.statSync(dir);
    if (!st.isDirectory()) throw new Error(`failed to create directory at ${dir}`);
}

function crashAsyncOrThrow(e) {
    const err = (e instanceof Error) ? e : new Error(String(e));
    setTimeout(() => { throw err; }, 0);
    throw err;
}

function createGunSqliteStoreOrThrow(dbFilePath) {
    requireString(dbFilePath, 'dbFilePath');
    ensureParentDirOrThrow(dbFilePath);

    // eslint-disable-next-line global-require
    const sqlite3 = require('@vscode/sqlite3');
    if (!sqlite3 || typeof sqlite3 !== 'object') throw new Error('@vscode/sqlite3 must export an object');
    const Database = sqlite3.Database;
    if (typeof Database !== 'function') throw new Error('@vscode/sqlite3.Database must be a function');

    const db = new Database(dbFilePath);

    let initDone = false;
    let initError = null;

    const state = {
        inFlight: 0,
        closing: false,
        closed: false,
        lastActivityMs: Date.now(),
    };

    function markActivityOrThrow() {
        state.lastActivityMs = Date.now();
        if (!Number.isFinite(state.lastActivityMs)) throw new Error('Date.now() returned non-finite');
    }

    function assertNotClosedOrThrow() {
        if (state.closed) throw new Error('sqlite store is closed');
    }

    function startOpOrThrow() {
        // NOTE: "closing" is treated as a draining phase.
        // We still accept operations until we can prove the store is idle.
        assertNotClosedOrThrow();
        if (!Number.isInteger(state.inFlight) || state.inFlight < 0 || state.inFlight > 1_000_000) throw new Error('inFlight corrupt');
        state.inFlight += 1;
        markActivityOrThrow();
    }

    function endOpOrThrow() {
        if (!Number.isInteger(state.inFlight) || state.inFlight < 1 || state.inFlight > 1_000_000) throw new Error('inFlight corrupt');
        state.inFlight -= 1;
        markActivityOrThrow();
    }
    // Treat init work as in-flight to prevent close during initialization.
    startOpOrThrow();
    db.exec(
        'PRAGMA journal_mode = WAL;\n'
        + 'CREATE TABLE IF NOT EXISTS KeyValueStore (\n'
        + '  key TEXT PRIMARY KEY,\n'
        + '  value TEXT NOT NULL\n'
        + ');\n',
        (err) => {
            initDone = true;
            initError = err || null;
            try {
                endOpOrThrow();
            } catch (e) {
                crashAsyncOrThrow(e);
                return;
            }
            if (initError) crashAsyncOrThrow(initError);
        },
    );

    const store = function store() { };

    store.put = (file, data, cb) => {
        requireString(String(file || ''), 'file');
        requireFunction(cb, 'cb');
        if (initError) crashAsyncOrThrow(initError);
        if (initDone !== true && initDone !== false) throw new Error('init state corrupt');

        startOpOrThrow();

        const v = (data === undefined || data === null) ? '' : String(data);
        db.run(
            'INSERT OR REPLACE INTO KeyValueStore (key, value) VALUES (?, ?)',
            [String(file), v],
            function onPut(err) {
                try {
                    endOpOrThrow();
                } catch (e) {
                    crashAsyncOrThrow(e);
                    return;
                }
                if (err) {
                    try { cb(err); } catch (_cbErr) { }
                    crashAsyncOrThrow(err);
                    return;
                }
                cb(null, 1);
            },
        );
    };

    store.get = (file, cb) => {
        requireString(String(file || ''), 'file');
        requireFunction(cb, 'cb');
        if (initError) crashAsyncOrThrow(initError);
        if (initDone !== true && initDone !== false) throw new Error('init state corrupt');

        startOpOrThrow();

        db.get(
            'SELECT value FROM KeyValueStore WHERE key = ?',
            [String(file)],
            (err, row) => {
                try {
                    endOpOrThrow();
                } catch (e) {
                    crashAsyncOrThrow(e);
                    return;
                }
                if (err) {
                    try { cb(err); } catch (_cbErr) { }
                    crashAsyncOrThrow(err);
                    return;
                }
                const v = row && typeof row.value === 'string' ? row.value : null;
                cb(null, v);
            },
        );
    };

    store.closeAsyncOrThrow = async (opts) => {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const quietMs = (o.quietMs === undefined || o.quietMs === null) ? 200 : Number(o.quietMs);
        const maxWaitMs = (o.maxWaitMs === undefined || o.maxWaitMs === null) ? 3000 : Number(o.maxWaitMs);
        if (!Number.isInteger(quietMs) || quietMs < 0 || quietMs > 2000) throw new Error('quietMs must be 0..2000');
        if (!Number.isInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 10000) throw new Error('maxWaitMs must be 0..10000');

        if (state.closed) return;
        state.closing = true;

        const started = Date.now();
        const delayMs = 50;
        const maxAttempts = Math.floor(maxWaitMs / delayMs) + 1;
        if (maxAttempts < 1 || maxAttempts > 300) throw new Error('maxAttempts out of bounds');

        for (let i = 0; i < maxAttempts; i++) {
            const inFlight = state.inFlight;
            if (!Number.isInteger(inFlight) || inFlight < 0 || inFlight > 1_000_000) throw new Error('inFlight corrupt');
            const since = Date.now() - state.lastActivityMs;
            if (!Number.isFinite(since) || since < -1000 || since > 60_000_000) throw new Error('lastActivityMs corrupt');

            if (inFlight === 0 && since >= quietMs) break;

            const elapsed = Date.now() - started;
            if (!Number.isFinite(elapsed)) throw new Error('elapsed not finite');
            if (elapsed >= maxWaitMs) throw new Error(`timeout waiting for sqlite store to become idle (inFlight=${String(inFlight)} quietForMs=${String(since)})`);

            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        state.closed = true;
    };

    store.close = () => {
        store.closeAsyncOrThrow().catch((e) => crashAsyncOrThrow(e));
    };

    return store;
}

module.exports = {
    createGunSqliteStoreOrThrow,
};
