const path = require('path');
const fs = require('fs');

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function _isFilePathString(p) {
    return typeof p === 'string' && p.length > 0;
}

function _fileExists(p) {
    if (!_isFilePathString(p)) return false;
    return !!fs.existsSync(p);
}

function _sanitizeOpenExternalUrl(url) {
    if (typeof url !== 'string') throw new Error('url must be a string');
    const trimmed = url.trim();
    if (!trimmed) throw new Error('url must be a non-empty string');
    // Only allow a small set of schemes to reduce abuse.
    if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
    throw new Error('url scheme not allowed');
}

function _sanitizeSaveDialogOptions(options) {
    if (options === undefined || options === null) return {};
    if (!options || typeof options !== 'object') throw new Error('options must be an object');
    /** @type {any} */
    const out = {};

    if (typeof options.title === 'string' && options.title.trim()) out.title = options.title;
    if (typeof options.buttonLabel === 'string' && options.buttonLabel.trim()) out.buttonLabel = options.buttonLabel;

    // `defaultPath` must be a string if provided. Passing undefined/null across IPC
    // can cause Electron to reject the options object on some platforms.
    if (typeof options.defaultPath === 'string' && options.defaultPath.trim()) out.defaultPath = options.defaultPath;

    if (typeof options.nameFieldLabel === 'string' && options.nameFieldLabel.trim()) out.nameFieldLabel = options.nameFieldLabel;
    if (typeof options.message === 'string' && options.message.trim()) out.message = options.message;
    if (typeof options.filters === 'object' && Array.isArray(options.filters)) out.filters = options.filters;

    // Common boolean flags
    if (typeof options.showsTagField === 'boolean') out.showsTagField = options.showsTagField;
    if (typeof options.showOverwriteConfirmation === 'boolean') out.showOverwriteConfirmation = options.showOverwriteConfirmation;

    return out;
}

function requireMainWindowOrThrow(win) {
    if (!win || typeof win !== 'object') throw new Error('mainWindow must be set');
    requireObject(win.webContents, 'mainWindow.webContents');
    return win;
}

function createDesktopBridge({ app, ipcMain, nativeTheme, clipboard, dialog, shell, powerMonitor }) {
    let mainWindow = null;

    function setMainWindow(win) {
        mainWindow = win;
    }

    function _send(channel, payload) {
        requireString(channel, 'channel');
        requireMainWindowOrThrow(mainWindow);
        requireFunction(mainWindow.webContents.send, 'mainWindow.webContents.send');
        mainWindow.webContents.send(channel, payload);
    }

    function startEventForwarding() {
        requireObject(nativeTheme, 'nativeTheme');
        requireFunction(nativeTheme.on, 'nativeTheme.on');

        nativeTheme.on('updated', () => {
            _send('electron-native-theme-updated', {
                shouldUseDarkColors: !!nativeTheme.shouldUseDarkColors,
                themeSource: nativeTheme.themeSource,
            });
        });

        requireObject(powerMonitor, 'powerMonitor');
        requireFunction(powerMonitor.on, 'powerMonitor.on');

        const forward = (type) => {
            requireString(type, 'powerMonitor event type');
            powerMonitor.on(type, () => _send('electron-power-event', { type }));
        };

        // Common powerMonitor events (varies by platform)
        const events = ['suspend', 'resume', 'on-ac', 'on-battery', 'shutdown', 'lock-screen', 'unlock-screen'];
        for (let i = 0; i < events.length; i++) {
            forward(events[i]);
        }
    }

    function registerIpcHandlers() {
        requireObject(ipcMain, 'ipcMain');
        requireFunction(ipcMain.handle, 'ipcMain.handle');
        requireObject(app, 'app');
        requireFunction(app.getPath, 'app.getPath');
        requireObject(dialog, 'dialog');
        requireFunction(dialog.showOpenDialog, 'dialog.showOpenDialog');
        requireFunction(dialog.showSaveDialog, 'dialog.showSaveDialog');
        requireObject(clipboard, 'clipboard');
        requireFunction(clipboard.readText, 'clipboard.readText');
        requireFunction(clipboard.writeText, 'clipboard.writeText');
        requireObject(shell, 'shell');
        requireFunction(shell.openExternal, 'shell.openExternal');
        requireFunction(shell.showItemInFolder, 'shell.showItemInFolder');

        // Dialogs
        ipcMain.handle('dialog:open', async (event, options) => {
            void event;
            requireMainWindowOrThrow(mainWindow);
            const res = await dialog.showOpenDialog(mainWindow, options || {});
            requireObject(res, 'showOpenDialog result');
            return res;
        });

        ipcMain.handle('dialog:save', async (event, options) => {
            void event;
            requireMainWindowOrThrow(mainWindow);
            const safeOptions = _sanitizeSaveDialogOptions(options);
            const res = await dialog.showSaveDialog(mainWindow, safeOptions);
            requireObject(res, 'showSaveDialog result');
            return res;
        });

        // Clipboard
        ipcMain.handle('clipboard:readText', async () => {
            const v = clipboard.readText();
            if (typeof v !== 'string') throw new Error('clipboard.readText must return a string');
            return v;
        });

        ipcMain.handle('clipboard:writeText', async (event, text) => {
            void event;
            clipboard.writeText(String(text ?? ''));
            return true;
        });

        // Theme
        ipcMain.handle('nativeTheme:get', async () => {
            requireObject(nativeTheme, 'nativeTheme');
            return {
                shouldUseDarkColors: !!nativeTheme.shouldUseDarkColors,
                themeSource: nativeTheme.themeSource,
            };
        });

        ipcMain.handle('nativeTheme:setThemeSource', async (event, themeSource) => {
            void event;
            requireObject(nativeTheme, 'nativeTheme');
            const v = String(themeSource || 'system');
            if (!['system', 'light', 'dark'].includes(v)) throw new Error('themeSource must be one of system|light|dark');
            nativeTheme.themeSource = v;
            return true;
        });

        // Shell helpers
        ipcMain.handle('shell:openExternal', async (event, url) => {
            void event;
            const safe = _sanitizeOpenExternalUrl(url);
            await shell.openExternal(safe);
            return true;
        });

        ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
            void event;
            if (!_isFilePathString(filePath)) throw new Error('filePath must be a non-empty string');
            const resolved = path.resolve(String(filePath));
            if (!_fileExists(resolved)) throw new Error('filePath does not exist');
            shell.showItemInFolder(resolved);
            return true;
        });

        // App paths (useful for logs/data dirs)
        ipcMain.handle('app:getPath', async (event, name) => {
            void event;
            const n = String(name || 'userData');
            // Allow a conservative subset; expand as needed.
            const allowed = ['userData', 'documents', 'downloads', 'desktop', 'music', 'pictures', 'videos', 'logs', 'temp'];
            if (!allowed.includes(n)) throw new Error('app.getPath name not allowed');
            const p = app.getPath(n);
            requireString(p, 'app.getPath result');
            return p;
        });

        // Relaunch (useful for quick dev refresh flows)
        ipcMain.handle('app:relaunch', async () => {
            app.relaunch();
            app.exit(0);
            return true;
        });
    }

    return {
        setMainWindow,
        registerIpcHandlers,
        startEventForwarding,
    };
}

module.exports = {
    createDesktopBridge,
};
