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

function loadRnTorOrThrow() {
    // This dependency is expected to exist only in RN builds.
    // Fail-fast if it's missing.
    // eslint-disable-next-line global-require
    const mod = require('react-native-nitro-tor');
    if (!mod || typeof mod !== 'object') throw new Error('react-native-nitro-tor did not export an object');

    const RnTor = mod.RnTor;
    if (!RnTor || typeof RnTor !== 'object') throw new Error('react-native-nitro-tor.RnTor is required');
    if (typeof RnTor.startTorIfNotRunning !== 'function') throw new Error('RnTor.startTorIfNotRunning is required');
    if (typeof RnTor.shutdownService !== 'function') throw new Error('RnTor.shutdownService is required');
    return RnTor;
}

async function start(opts) {
    requireObject(opts, 'opts');

    // Mirror the old rn_tor_app shape, but fail-fast on missing fields.
    requireString(opts.dataDir, 'opts.dataDir');
    const socksPort = requirePort(opts.socksPort, 'opts.socksPort');
    const targetPort = requirePort(opts.targetPort, 'opts.targetPort');

    const timeoutMs = (opts.timeoutMs === undefined || opts.timeoutMs === null) ? 60000 : Number(opts.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('opts.timeoutMs must be a positive number');

    requireArray(opts.keys, 'opts.keys');
    if (opts.keys.length < 1) throw new Error('opts.keys must have at least 1 entry');

    const RnTor = loadRnTorOrThrow();
    const result = await RnTor.startTorIfNotRunning({
        data_dir: opts.dataDir,
        socks_port: socksPort,
        target_port: targetPort,
        timeout_ms: timeoutMs,
        keys: opts.keys,
    });

    if (!result || typeof result !== 'object') throw new Error('RnTor.startTorIfNotRunning returned non-object');
    if (result.is_success !== true) {
        const msg = result.error_message ? String(result.error_message) : 'unknown tor start error';
        throw new Error(`tor start failed: ${msg}`);
    }

    return result;
}

async function stop() {
    const RnTor = loadRnTorOrThrow();
    const ok = await RnTor.shutdownService();
    if (ok !== true) throw new Error('tor shutdown failed');
    return { ok: true };
}

async function status() {
    // We can extend this once we confirm the react-native-nitro-tor status API.
    throw new Error('tor.status not implemented for react-native yet');
}

module.exports = {
    start,
    stop,
    status,
};
