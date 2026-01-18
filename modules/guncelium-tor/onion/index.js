'use strict';

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requirePositiveInt(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
    return n;
}

function requireStringOrNull(value, name) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
    return value;
}

function generateV3OnionVanity(opts) {
    requireObject(opts, 'opts');

    const prefix = requireStringOrNull(opts.prefix, 'opts.prefix');
    const maxAttempts = (opts.maxAttempts === undefined || opts.maxAttempts === null) ? 250000 : requirePositiveInt(opts.maxAttempts, 'opts.maxAttempts');

    // Node/Electron-main implementation.
    // eslint-disable-next-line global-require
    const onionCrypto = require('../main/service/onionCrypto');
    if (!onionCrypto || typeof onionCrypto !== 'object') throw new Error('onionCrypto did not export an object');
    if (typeof onionCrypto.generateOnionKeypairVanity !== 'function') throw new Error('onionCrypto.generateOnionKeypairVanity is required');
    if (typeof onionCrypto.pkcs8SeedFromDer !== 'function') throw new Error('onionCrypto.pkcs8SeedFromDer is required');

    const gen = onionCrypto.generateOnionKeypairVanity(prefix, maxAttempts);
    if (!gen || typeof gen !== 'object') throw new Error('generateOnionKeypairVanity returned non-object');
    if (!gen.privDer || !gen.pubRaw || !gen.onion) throw new Error('generateOnionKeypairVanity returned incomplete keypair');

    const seed = onionCrypto.pkcs8SeedFromDer(gen.privDer);
    if (!seed || typeof seed.length !== 'number' || seed.length !== 32) throw new Error('derived seed must be 32 bytes');

    return {
        onion: String(gen.onion),
        seed_hex: seed.toString('hex'),
        pub_hex: gen.pubRaw.toString('hex'),
        attempts: Number(gen.attempts) || null,
    };
}

module.exports = {
    generateV3OnionVanity,
};
