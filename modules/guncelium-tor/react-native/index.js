'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requirePort(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be an integer 1..65535`);
    return n;
}

function requireArray(value, name) {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}

function normalizeKeysOrThrow(keys) {
    requireArray(keys, 'opts.keys');
    if (keys.length < 1) throw new Error('opts.keys must have at least 1 entry');

    // eslint-disable-next-line global-require
    const onion = require('../onion');
    if (!onion || typeof onion !== 'object') throw new Error('guncelium-tor/onion did not export an object');
    if (typeof onion.generateV3OnionVanity !== 'function') throw new Error('guncelium-tor/onion.generateV3OnionVanity is required');

    const out = [];
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (!k || typeof k !== 'object') throw new Error(`opts.keys[${i}] must be an object`);

        if (k.generate === true && k.vanity) {
            const gen = onion.generateV3OnionVanity({
                prefix: String(k.vanity),
                maxAttempts: (k.maxAttempts === undefined || k.maxAttempts === null) ? 250000 : Number(k.maxAttempts),
            });
            out.push({
                onion: gen.onion,
                seed_hex: gen.seed_hex,
                pub_hex: gen.pub_hex,
                generate: false,
            });
            continue;
        }

        out.push(k);
    }
    return out;
}

function loadRnTorOrThrow() {
    // IMPORTANT:
    // The react-native-nitro-tor "RnTor" JS wrapper spreads a NitroModule proxy into a plain object.
    // NitroModule methods are not enumerable, so the spread drops methods (like getServiceStatus).
    // To avoid importing a non-exported subpath (Metro warning), resolve the NitroModule via craby-modules.
    // eslint-disable-next-line global-require
    const craby = require('craby-modules');
    if (!craby || typeof craby !== 'object') throw new Error('craby-modules did not export an object');
    if (!craby.NativeModuleRegistry || typeof craby.NativeModuleRegistry !== 'object') throw new Error('craby-modules.NativeModuleRegistry is required');
    if (typeof craby.NativeModuleRegistry.getEnforcing !== 'function') throw new Error('NativeModuleRegistry.getEnforcing is required');

    const NativeTor = craby.NativeModuleRegistry.getEnforcing('ReactNativeNitroTor');
    if (!NativeTor || typeof NativeTor !== 'object') throw new Error('NativeTor must be an object');
    if (typeof NativeTor.startTorIfNotRunning !== 'function') throw new Error('NativeTor.startTorIfNotRunning is required');
    if (typeof NativeTor.getServiceStatus !== 'function') throw new Error('NativeTor.getServiceStatus is required');
    if (typeof NativeTor.shutdownService !== 'function') throw new Error('NativeTor.shutdownService is required');

    return {
        initTorService: (typeof NativeTor.initTorService === 'function') ? NativeTor.initTorService.bind(NativeTor) : undefined,
        createHiddenService: (typeof NativeTor.createHiddenService === 'function') ? NativeTor.createHiddenService.bind(NativeTor) : undefined,
        deleteHiddenService: (typeof NativeTor.deleteHiddenService === 'function') ? NativeTor.deleteHiddenService.bind(NativeTor) : undefined,
        getServiceStatus: NativeTor.getServiceStatus.bind(NativeTor),
        shutdownService: NativeTor.shutdownService.bind(NativeTor),
        httpGet: (typeof NativeTor.httpGet === 'function') ? NativeTor.httpGet.bind(NativeTor) : undefined,
        httpPost: (typeof NativeTor.httpPost === 'function') ? NativeTor.httpPost.bind(NativeTor) : undefined,
        httpPut: (typeof NativeTor.httpPut === 'function') ? NativeTor.httpPut.bind(NativeTor) : undefined,
        httpDelete: (typeof NativeTor.httpDelete === 'function') ? NativeTor.httpDelete.bind(NativeTor) : undefined,
        async startTorIfNotRunning(params) {
            if (!params || typeof params !== 'object') throw new Error('startTorIfNotRunning params must be an object');
            const { keys, ...rest } = params;

            const nativeParams = {
                ...rest,
                keys_json: (keys && Array.isArray(keys) && keys.length > 0) ? JSON.stringify(keys) : '',
            };

            const nativeResp = await NativeTor.startTorIfNotRunning(nativeParams);
            if (!nativeResp || typeof nativeResp !== 'object') throw new Error('NativeTor.startTorIfNotRunning returned non-object');

            let onion_addresses;
            if (nativeResp.onion_addresses_json) {
                try {
                    const parsed = JSON.parse(nativeResp.onion_addresses_json);
                    if (Array.isArray(parsed)) onion_addresses = parsed.filter((x) => typeof x === 'string');
                } catch (_e) {
                    onion_addresses = undefined;
                }
            }

            return {
                ...nativeResp,
                onion_addresses,
            };
        },
    };
}

function fileUriToPathOrThrow(fileUri, name) {
    requireString(fileUri, name);
    const u = String(fileUri);
    if (!u.startsWith('file://')) throw new Error(`${name} must start with file://`);
    const p = u.replace(/^file:\/\/+/, '/');
    if (!p.startsWith('/')) throw new Error(`${name} must convert to an absolute path`);
    return p;
}

function pathToFileUriOrThrow(pathValue, name) {
    requireString(pathValue, name);
    const p = String(pathValue);
    if (!p.startsWith('/')) throw new Error(`${name} must be an absolute path starting with /`);
    const uri = `file://${p}`;
    return uri.replace(/^file:\/\/+/, 'file:///');
}

function stripOnionSuffix(value) {
    if (value === undefined || value === null) return null;
    let s = String(value).trim();
    if (!s) return null;

    // Accept common forms:
    // - <host>.onion
    // - <host>.onion:<port>
    // - http://<host>.onion[:port]/...
    const schemeIdx = s.indexOf('://');
    if (schemeIdx >= 0) s = s.slice(schemeIdx + 3);
    const slashIdx = s.indexOf('/');
    if (slashIdx >= 0) s = s.slice(0, slashIdx);
    const colonIdx = s.lastIndexOf(':');
    if (colonIdx >= 0) s = s.slice(0, colonIdx);

    return s.replace(/\.onion$/i, '');
}

function normalizeOnionAddress(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!s) return null;
    return s;
}

function requirePositiveNumber(value, name) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
    return n;
}

function requireBooleanOrDefault(value, name, defaultValue) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
    return value;
}

function isRunningFromStatusCode(code) {
    // Per react-native-nitro-tor README:
    // 0: starting, 1: running, 2: stopped/error
    const n = Number(code);
    return n === 0 || n === 1;
}

function createTorReactNativeApiOrThrow() {
    const state = {
        dataDir: null,
        socksPort: 8765,
        timeoutMs: 60000,
        pendingHs: null,
        lastStart: null,
    };

    async function ensureDataDirOrThrow() {
        if (state.dataDir) return state.dataDir;

        // expo-file-system exports legacy function stubs from the root that throw at runtime.
        // Use the legacy module for stable documentDirectory + makeDirectoryAsync.
        // eslint-disable-next-line global-require
        const FS = require('expo-file-system/legacy');
        if (!FS || typeof FS !== 'object') throw new Error('expo-file-system/legacy did not export an object');
        if (typeof FS.documentDirectory !== 'string' || FS.documentDirectory.trim().length === 0) throw new Error('expo-file-system/legacy.documentDirectory is required');
        if (typeof FS.makeDirectoryAsync !== 'function') throw new Error('expo-file-system/legacy.makeDirectoryAsync is required');

        const base = fileUriToPathOrThrow(String(FS.documentDirectory), 'expo-file-system/legacy.documentDirectory');
        const dir = base.endsWith('/') ? `${base}guncelium/tor` : `${base}/guncelium/tor`;
        await FS.makeDirectoryAsync(pathToFileUriOrThrow(dir, 'tor dataDir'), { intermediates: true });
        state.dataDir = dir;
        return dir;
    }

    async function info() {
        const RnTor = loadRnTorOrThrow();
        if (typeof RnTor.getServiceStatus !== 'function') throw new Error('RnTor.getServiceStatus is required');
        const code = await RnTor.getServiceStatus();
        return {
            ok: true,
            installed: true,
            running: isRunningFromStatusCode(code),
            mode: 'react-native',
            socksPort: state.socksPort,
            dataDir: state.dataDir,
            native: { serviceStatus: code },
        };
    }

    async function status() {
        return info();
    }

    async function start(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const cleanSlate = requireBooleanOrDefault(o.cleanSlate, 'opts.cleanSlate', false);
        void cleanSlate;

        const dataDir = await ensureDataDirOrThrow();
        const RnTor = loadRnTorOrThrow();

        // Prefer pending hidden service configuration created via hiddenServices.create().
        const pending = state.pendingHs;
        const timeoutMs = state.timeoutMs;
        requirePositiveNumber(timeoutMs, 'timeoutMs');

        if (pending) {
            requireObject(pending, 'pending hidden service');
            const result = await RnTor.startTorIfNotRunning({
                data_dir: dataDir,
                socks_port: state.socksPort,
                target_port: pending.localPort,
                timeout_ms: timeoutMs,
                keys: pending.keys,
            });

            if (!result || typeof result !== 'object') throw new Error('RnTor.startTorIfNotRunning returned non-object');
            if (result.is_success !== true) {
                const msg = result.error_message ? String(result.error_message) : 'unknown tor start error';
                throw new Error(`tor start failed: ${msg}`);
            }

            state.lastStart = {
                ts: Date.now(),
                service: pending.service,
                localPort: pending.localPort,
                virtualPort: pending.virtualPort,
                onionAddress: normalizeOnionAddress(result.onion_address),
                onionAddresses: Array.isArray(result.onion_addresses) ? result.onion_addresses.map(normalizeOnionAddress).filter(Boolean) : null,
                onion: stripOnionSuffix(result.onion_address || (Array.isArray(result.onion_addresses) ? result.onion_addresses[0] : null)),
                raw: result,
            };

            return {
                ok: true,
                running: true,
                installed: true,
                mode: 'react-native',
                service: pending.service,
                onion: state.lastStart.onion,
                onionAddress: state.lastStart.onionAddress,
            };
        }

        if (typeof RnTor.initTorService !== 'function') throw new Error('RnTor.initTorService is required to start Tor without a hidden service');
        const ok = await RnTor.initTorService({
            socks_port: state.socksPort,
            data_dir: dataDir,
            timeout_ms: timeoutMs,
        });
        if (ok !== true) throw new Error('RnTor.initTorService returned false');

        state.lastStart = { ts: Date.now(), service: null, localPort: null, virtualPort: null, onion: null, raw: { ok: true } };
        return { ok: true, running: true, installed: true, mode: 'react-native' };
    }

    async function stop() {
        const RnTor = loadRnTorOrThrow();
        if (typeof RnTor.shutdownService !== 'function') throw new Error('RnTor.shutdownService is required');
        const ok = await RnTor.shutdownService();
        if (ok !== true) throw new Error('tor shutdown failed');
        return { ok: true, running: false };
    }

    async function httpGet(opts) {
        requireObject(opts, 'opts');
        requireString(opts.url, 'opts.url');

        const headers = (opts.headers === undefined || opts.headers === null) ? '' : String(opts.headers);
        const timeoutMs = (opts.timeout_ms === undefined || opts.timeout_ms === null)
            ? 30000
            : requirePositiveNumber(opts.timeout_ms, 'opts.timeout_ms');

        const RnTor = loadRnTorOrThrow();
        if (typeof RnTor.httpGet !== 'function') throw new Error('RnTor.httpGet is required');

        const result = await RnTor.httpGet({ url: String(opts.url), headers, timeout_ms: timeoutMs });
        if (!result || typeof result !== 'object') throw new Error('RnTor.httpGet returned non-object');
        return result;
    }

    async function configureHiddenService(opts) {
        requireObject(opts, 'opts');
        const localPort = requirePort(opts.port, 'opts.port');
        const virtualPort = (opts.virtualPort === undefined || opts.virtualPort === null) ? 80 : requirePort(opts.virtualPort, 'opts.virtualPort');

        const service = (opts.service === undefined || opts.service === null) ? 'default' : String(opts.service);
        if (!service.trim()) throw new Error('opts.service must be a non-empty string');

        const keys = normalizeKeysOrThrow(opts.keys);
        state.pendingHs = {
            service,
            localPort,
            virtualPort,
            keys,
        };

        return { ok: true, pending: true, service, localPort, virtualPort, keyCount: keys.length };
    }

    async function hiddenServicesStatus() {
        const last = state.lastStart;
        const pending = state.pendingHs;

        const service = (last && last.service) ? last.service : (pending ? pending.service : null);
        const localPort = (last && last.localPort) ? last.localPort : (pending ? pending.localPort : null);
        const virtualPort = (last && last.virtualPort) ? last.virtualPort : (pending ? pending.virtualPort : null);

        const onion = (last && last.onion) ? last.onion : null;
        const results = onion ? [{ ok: true, service, localPort, virtualPort, onion }] : [];

        return {
            ok: true,
            ts: last ? last.ts : null,
            service,
            localPort,
            virtualPort,
            results,
        };
    }

    return {
        // Electron API parity: install/uninstall are desktop-only.
        start,
        stop,
        status,
        info,
        hiddenServices: {
            create: configureHiddenService,
            status: hiddenServicesStatus,
        },
        httpGet,
    };
}

module.exports = createTorReactNativeApiOrThrow();
