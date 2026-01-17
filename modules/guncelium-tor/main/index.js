'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function registerIpcHandlersOrThrow({ ipcMain, electronApp }) {
    requireObject(ipcMain, 'ipcMain');
    requireFunction(ipcMain.handle, 'ipcMain.handle');
    requireObject(electronApp, 'electronApp');

    // eslint-disable-next-line global-require
    const { registerTorIpc } = require('./service/ipc');
    requireFunction(registerTorIpc, 'registerTorIpc');

    const state = {
        torChild: null,
        torLogFile: null,
        getTorLastError: null,
        getTorLastExit: null,
        controlPort: null,
    };

    registerTorIpc({ ipcMain, app: electronApp, state });
}

module.exports = {
    registerIpcHandlersOrThrow,
};
