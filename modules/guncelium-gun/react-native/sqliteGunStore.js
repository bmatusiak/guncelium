'use strict';

const {
    createSqliteKeyValueOrThrow,
    crashAsyncOrThrow,
    requireFunction,
    requireString,
} = require('./sqliteKeyValue');

function createGunSqliteStoreOrThrow(dbName) {
    requireString(dbName, 'dbName');

    const kv = createSqliteKeyValueOrThrow(dbName);

    // Gun expects a "store" function/object with put/get methods.
    const store = function store() {};

    store.put = (file, data, cb) => {
        requireString(String(file || ''), 'file');
        requireFunction(cb, 'cb');

        (async () => {
            await kv.setItemOrThrow(String(file), data);
            cb(null, 1);
        })().catch((e) => {
            try { cb(e); } catch (_cbErr) { }
            crashAsyncOrThrow(e);
        });
    };

    store.get = (file, cb) => {
        requireString(String(file || ''), 'file');
        requireFunction(cb, 'cb');

        (async () => {
            const v = await kv.getItemOrThrow(String(file));
            cb(null, v);
        })().catch((e) => {
            try { cb(e); } catch (_cbErr) { }
            crashAsyncOrThrow(e);
        });
    };

    return store;
}

module.exports = {
    createGunSqliteStoreOrThrow,
};
