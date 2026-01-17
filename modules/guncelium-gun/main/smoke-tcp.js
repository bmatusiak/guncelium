'use strict';

const fs = require('fs');
const path = require('path');

const { registerIpcHandlersOrThrow } = require('./index.js');

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function createTempUserDataDirOrThrow() {
    const dir = path.join(process.cwd(), '.tmp', 'gun-ipc-smoke');
    fs.mkdirSync(dir, { recursive: true });
    const st = fs.statSync(dir);
    if (!st.isDirectory()) throw new Error('failed to create temp userData dir');
    return dir;
}

async function main() {
    const userData = createTempUserDataDirOrThrow();

    const handlers = new Map();
    const ipcMain = {
        handle: (channel, fn) => {
            if (handlers.has(channel)) throw new Error(`duplicate channel: ${channel}`);
            handlers.set(channel, fn);
        },
    };
    const electronApp = {
        getPath: (name) => {
            if (name !== 'userData') throw new Error(`unexpected getPath: ${name}`);
            return userData;
        },
    };

    registerIpcHandlersOrThrow({ ipcMain, electronApp });

    const start = handlers.get('gun:tcp:start');
    const status = handlers.get('gun:tcp:status');
    const stop = handlers.get('gun:tcp:stop');

    requireFunction(start, 'gun:tcp:start');
    requireFunction(status, 'gun:tcp:status');
    requireFunction(stop, 'gun:tcp:stop');

    const started = await start(null, { port: 0, host: '127.0.0.1', peers: [] });
    requireObject(started, 'started');
    if (started.ok !== true || started.running !== true || !started.port) {
        throw new Error(`unexpected start result: ${JSON.stringify(started)}`);
    }

    const st = await status(null);
    requireObject(st, 'status');
    if (st.ok !== true || st.running !== true || st.port !== started.port) {
        throw new Error(`unexpected status result: ${JSON.stringify(st)}`);
    }

    const stopped = await stop(null);
    requireObject(stopped, 'stopped');
    if (stopped.ok !== true || stopped.running !== false) {
        throw new Error(`unexpected stop result: ${JSON.stringify(stopped)}`);
    }

    console.log(JSON.stringify({ ok: true, port: started.port }));
    process.exit(0);
}

main().catch((e) => {
    // fail-fast
    console.error(e && e.stack ? e.stack : String(e));
    process.exitCode = 1;
});
