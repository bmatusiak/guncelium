'use strict';

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function crashAsyncOrThrow(e) {
    const err = (e instanceof Error) ? e : new Error(String(e));
    setTimeout(() => { throw err; }, 0);
    throw err;
}

function createSqliteKeyValueOrThrow(dbName) {
    requireString(dbName, 'dbName');

    // eslint-disable-next-line global-require
    const SQLite = require('expo-sqlite');
    if (!SQLite || typeof SQLite.openDatabaseAsync !== 'function') throw new Error('expo-sqlite.openDatabaseAsync is required');

    const state = {
        initPromise: null,
        db: null,
    };

    async function initOrThrow() {
        if (state.db) return state.db;
        if (state.initPromise) return await state.initPromise;

        state.initPromise = (async () => {
            const db = await SQLite.openDatabaseAsync(dbName);
            if (!db || typeof db.execAsync !== 'function') throw new Error('expo-sqlite database missing execAsync');
            if (typeof db.runAsync !== 'function') throw new Error('expo-sqlite database missing runAsync');
            if (typeof db.getFirstAsync !== 'function') throw new Error('expo-sqlite database missing getFirstAsync');

            await db.execAsync(
                'CREATE TABLE IF NOT EXISTS KeyValueStore (\n'
                + '  key TEXT PRIMARY KEY,\n'
                + '  value TEXT NOT NULL\n'
                + ');',
            );

            state.db = db;
            return db;
        })();

        try {
            return await state.initPromise;
        } catch (e) {
            // Ensure later calls do not reuse a rejected promise.
            state.initPromise = null;
            crashAsyncOrThrow(e);
            return null;
        }
    }

    async function setItemOrThrow(key, value) {
        requireString(key, 'key');
        // Gun store values are typically strings; accept anything stringify-able but store as string.
        const v = (value === undefined || value === null) ? '' : String(value);
        const db = await initOrThrow();
        if (!db) throw new Error('sqlite db not initialized');
        await db.runAsync('INSERT OR REPLACE INTO KeyValueStore (key, value) VALUES (?, ?)', [key, v]);
    }

    async function getItemOrThrow(key) {
        requireString(key, 'key');
        const db = await initOrThrow();
        if (!db) throw new Error('sqlite db not initialized');
        const row = await db.getFirstAsync('SELECT value FROM KeyValueStore WHERE key = ?', [key]);
        if (!row) return null;
        if (typeof row.value !== 'string') throw new Error('sqlite row.value must be a string');
        return row.value;
    }

    return {
        initOrThrow,
        setItemOrThrow,
        getItemOrThrow,
    };
}

module.exports = {
    createSqliteKeyValueOrThrow,
    crashAsyncOrThrow,
    requireFunction,
    requireString,
};
