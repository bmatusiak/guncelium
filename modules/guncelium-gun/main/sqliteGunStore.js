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
    const Database = require('better-sqlite3');
    if (typeof Database !== 'function') throw new Error('better-sqlite3 export must be a function');

    const db = new Database(dbFilePath);
    db.pragma('journal_mode = WAL');
    db.exec(
        'CREATE TABLE IF NOT EXISTS KeyValueStore (\n'
        + '  key TEXT PRIMARY KEY,\n'
        + '  value TEXT NOT NULL\n'
        + ');',
    );

    const stmtPut = db.prepare('INSERT OR REPLACE INTO KeyValueStore (key, value) VALUES (?, ?)');
    const stmtGet = db.prepare('SELECT value FROM KeyValueStore WHERE key = ?');

    const store = function store() {};

    store.put = (file, data, cb) => {
        requireString(String(file || ''), 'file');
        requireFunction(cb, 'cb');
        try {
            const v = (data === undefined || data === null) ? '' : String(data);
            stmtPut.run(String(file), v);
            cb(null, 1);
        } catch (e) {
            try { cb(e); } catch (_cbErr) { }
            crashAsyncOrThrow(e);
        }
    };

    store.get = (file, cb) => {
        requireString(String(file || ''), 'file');
        requireFunction(cb, 'cb');
        try {
            const row = stmtGet.get(String(file));
            const v = row && typeof row.value === 'string' ? row.value : null;
            cb(null, v);
        } catch (e) {
            try { cb(e); } catch (_cbErr) { }
            crashAsyncOrThrow(e);
        }
    };

    store.close = () => {
        try {
            db.close();
        } catch (e) {
            crashAsyncOrThrow(e);
        }
    };

    return store;
}

module.exports = {
    createGunSqliteStoreOrThrow,
};
