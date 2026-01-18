const { app, BrowserWindow, ipcMain, session, nativeTheme, clipboard, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const { createDeepLinkBridge } = require('./deeplinks');
const { installCspHeaders } = require('./csp');
const { createDesktopBridge } = require('./desktop');

let mainWindow;
const DEV_URL = process.env.EXPO_WEB_URL || 'http://localhost:8081';
const PROD_INDEX = path.join(__dirname, '..', 'app', 'index.html');
const ENABLE_RENDERER_DIAGNOSTICS = (!app.isPackaged) && (process.env.NODE_ENV !== 'production');
// Default ON in dev to support automated test runs.
// Opt out with: GUNCELIUM_AUTO_EXIT_ON_TEST_COMPLETE=0
const AUTO_EXIT_ON_TEST_COMPLETE = (!app.isPackaged) && (process.env.GUNCELIUM_AUTO_EXIT_ON_TEST_COMPLETE !== '0');

const deepLinks = createDeepLinkBridge({ app });
const desktop = createDesktopBridge({ app, ipcMain, nativeTheme, clipboard, dialog, shell, powerMonitor });

desktop.registerIpcHandlers();

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function installRendererLogForwardingOrThrow() {
    void AUTO_EXIT_ON_TEST_COMPLETE;

    ipcMain.on('renderer:console', (event, payload) => {
        void event;
        requireObject(payload, 'payload');
        requireString(payload.level, 'payload.level');
        const ts = typeof payload.ts === 'number' ? payload.ts : Date.now();
        const args = Array.isArray(payload.args) ? payload.args : [];
        const line = `[renderer:${payload.level}] ${new Date(ts).toISOString()} ${args.join(' ')}`;
        if (payload.level === 'error') console.error(line);
        else if (payload.level === 'warn') console.warn(line);
        else console.log(line);
    });

    ipcMain.on('renderer:uncaught', (event, payload) => {
        void event;
        requireObject(payload, 'payload');
        requireString(payload.kind, 'payload.kind');
        const ts = typeof payload.ts === 'number' ? payload.ts : Date.now();
        const p = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
        const msg = `[renderer:${payload.kind}] ${new Date(ts).toISOString()} ${p.message || ''}`;
        console.error(msg);
        if (p.stack) console.error(String(p.stack));
        if (payload.kind === 'unhandledrejection' && p.reason) console.error(String(p.reason));
    });
}

if (ENABLE_RENDERER_DIAGNOSTICS) {
    installRendererLogForwardingOrThrow();
}

// Register IPC endpoints for app modules (fail-fast if missing).
// These back the Electron preload bridge used by the renderer.
const { registerIpcHandlersOrThrow: registerGunIpcHandlersOrThrow } = require('guncelium-gun/main');
const { registerIpcHandlersOrThrow: registerTorIpcHandlersOrThrow } = require('guncelium-tor/main');

registerGunIpcHandlersOrThrow({ ipcMain, electronApp: app });
registerTorIpcHandlersOrThrow({ ipcMain, electronApp: app });

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function attachRendererDiagnosticsOrThrow(win) {
    requireObject(win, 'win');
    requireObject(win.webContents, 'win.webContents');
    requireFunction(win.webContents.on, 'win.webContents.on');

    const levelName = (lvl) => {
        if (lvl === 0) return 'debug';
        if (lvl === 1) return 'info';
        if (lvl === 2) return 'warn';
        if (lvl === 3) return 'error';
        return 'log';
    };

    // New signature: listener receives Event<WebContentsConsoleMessageEventParams>.
    win.webContents.on('console-message', (event) => {
        requireObject(event, 'console-message event');
        if (typeof event.message !== 'string') throw new Error('console-message event.message missing');
        const lvl = levelName(event.level);
        const src = event.sourceId ? String(event.sourceId) : 'unknown';
        const ln = Number.isFinite(Number(event.lineNumber)) ? Number(event.lineNumber) : 0;
        // Print in a grep-friendly format.
        // eslint-disable-next-line no-console
        console[lvl](`[renderer:${lvl}] ${src}:${ln} ${String(event.message)}`);
    });

    win.webContents.on('render-process-gone', (event, details) => {
        void event;
        // eslint-disable-next-line no-console
        console.error('[renderer:render-process-gone]', details);
    });

    win.webContents.on('preload-error', (event, preloadPath, error) => {
        void event;
        // eslint-disable-next-line no-console
        console.error('[renderer:preload-error]', { preloadPath, error: error && error.message ? error.message : String(error) });
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        void event;
        // eslint-disable-next-line no-console
        console.error('[renderer:did-fail-load]', { errorCode, errorDescription, validatedURL });
    });
}

function attachAutoExitOnTestCompleteOrThrow(win) {
    if (!AUTO_EXIT_ON_TEST_COMPLETE) return;
    requireObject(win, 'win');
    requireObject(win.webContents, 'win.webContents');
    requireFunction(win.webContents.on, 'win.webContents.on');

    let didAutoExit = false;

    function maybeExitFromMessageOrThrow(msg) {
        if (didAutoExit) return;
        requireString(msg, 'console message');

        // Example: "[Moniker] TEST COMPLETE | Passed: 2 Failed: 0 (1.81s)"
        const m = msg.match(/TEST COMPLETE \| Passed: (\d+) Failed: (\d+) \(([^)]+)\)/);
        if (!m) return;

        const passed = Number(m[1]);
        const failed = Number(m[2]);
        if (!Number.isInteger(passed) || passed < 0) throw new Error('invalid passed count');
        if (!Number.isInteger(failed) || failed < 0) throw new Error('invalid failed count');

        const exitCode = failed === 0 ? 0 : 1;
        didAutoExit = true;
        // eslint-disable-next-line no-console
        console.log(`[main] auto-exit on test complete: passed=${passed} failed=${failed} exitCode=${exitCode}`);
        setTimeout(() => app.exit(exitCode), 50);
    }

    // New signature: listener receives Event<WebContentsConsoleMessageEventParams>.
    win.webContents.on('console-message', (event) => {
        requireObject(event, 'console-message event');
        if (typeof event.message !== 'string') throw new Error('console-message event.message missing');
        maybeExitFromMessageOrThrow(event.message);
    });
}

function createWindow() {
    const preloadPath = process.env.EXPO_PRELOAD_PATH
        ? path.resolve(process.env.EXPO_PRELOAD_PATH)
        : (ENABLE_RENDERER_DIAGNOSTICS
            ? path.join(__dirname, 'preload-logging.js')
            : path.join(__dirname, 'preload-hardened.js'));
    mainWindow = new BrowserWindow({
        width: 480,
        height: 960,
        webPreferences: {
            preload: preloadPath,
            webviewTag: true,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        },
    });

    attachAutoExitOnTestCompleteOrThrow(mainWindow);

    if (ENABLE_RENDERER_DIAGNOSTICS) {
        attachRendererDiagnosticsOrThrow(mainWindow);
    }
    deepLinks.setMainWindow(mainWindow);
    desktop.setMainWindow(mainWindow);

    // Determine whether a production index exists in the packaged app.
    // If the production index is present we prefer it (packaged apps should
    // always load local files). Only fall back to the dev server when a
    // production build is not available and NODE_ENV indicates development.
    const isDev = process.env.NODE_ENV === 'development';
    const hasProdIndex = fs.existsSync(PROD_INDEX);

    if (hasProdIndex) {
        mainWindow.loadFile(PROD_INDEX).catch((err) => {
            console.error('Failed to load production index', PROD_INDEX, err);
            app.exit(1);
        });
    } else if (isDev && DEV_URL) {
        mainWindow.loadURL(DEV_URL).catch((err) => {
            console.error('Failed to load dev URL', DEV_URL, err);
            app.exit(1);
        });
    } else {
        console.error('No production index found and dev server not available at', DEV_URL);
        app.exit(1);
    }
}

// electron-squirrel-startup is only needed for Squirrel.Windows install/uninstall events.
let isSquirrelStartup = !!require('electron-squirrel-startup');
if (isSquirrelStartup) {
    app.quit();
} else if (deepLinks.gotTheLock) {
    app.whenReady().then(() => {
        deepLinks.registerProtocols();
        installCspHeaders({ session });
        createWindow();
        desktop.startEventForwarding();

        if (process.env.NODE_ENV === 'development') {
            try {
                const watchDir = path.join(__dirname);
                fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
                    if (!filename) return;
                    if (mainWindow && mainWindow.webContents) {
                        mainWindow.webContents.send('main-changed', { event: eventType, file: filename });
                    }
                });
            } catch (e) {
                console.warn('watcher failed', e && e.message);
            }
        }
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
