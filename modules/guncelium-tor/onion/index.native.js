'use strict';

const Crypto = require('expo-crypto');
const nacl = require('tweetnacl');
const { sha3_256: sha3_256_js } = require('js-sha3');

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

function randomBytes32OrThrow() {
    if (!Crypto || typeof Crypto !== 'object') throw new Error('expo-crypto did not export an object');
    if (typeof Crypto.getRandomValues !== 'function') throw new Error('expo-crypto.getRandomValues is required for RN onion vanity generation');

    const out = new Uint8Array(32);
    Crypto.getRandomValues(out);
    if (out.length !== 32) throw new Error('random byte buffer must be 32 bytes');
    return out;
}

function sha3_256(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('sha3_256 expects Uint8Array');
    const ab = sha3_256_js.arrayBuffer(bytes);
    return new Uint8Array(ab);
}

function base32Encode(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('base32Encode expects Uint8Array');
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
            const index = (value >>> (bits - 5)) & 31;
            bits -= 5;
            output += alphabet[index];
        }
    }
    if (bits > 0) {
        const index = (value << (5 - bits)) & 31;
        output += alphabet[index];
    }
    return output;
}

function bytesToHex(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('bytesToHex expects Uint8Array');
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

function deriveOnionFromPub(pubRaw32) {
    if (!(pubRaw32 instanceof Uint8Array) || pubRaw32.length !== 32) throw new Error('pubRaw32 must be 32 bytes');
    const version = new Uint8Array([0x03]);

    const prefix = new Uint8Array([46, 111, 110, 105, 111, 110, 32, 99, 104, 101, 99, 107, 115, 117, 109]);
    const checksumInput = new Uint8Array(prefix.length + pubRaw32.length + version.length);
    checksumInput.set(prefix, 0);
    checksumInput.set(pubRaw32, prefix.length);
    checksumInput.set(version, prefix.length + pubRaw32.length);

    const checksumFull = sha3_256(checksumInput);
    const checksum2 = checksumFull.slice(0, 2);

    const addrBytes = new Uint8Array(32 + 2 + 1);
    addrBytes.set(pubRaw32, 0);
    addrBytes.set(checksum2, 32);
    addrBytes.set(version, 34);

    return base32Encode(addrBytes);
}

function generateV3OnionVanity(opts) {
    requireObject(opts, 'opts');

    const prefix = requireStringOrNull(opts.prefix, 'opts.prefix');
    const maxAttempts = (opts.maxAttempts === undefined || opts.maxAttempts === null) ? 250000 : requirePositiveInt(opts.maxAttempts, 'opts.maxAttempts');
    const want = prefix ? String(prefix).toLowerCase() : null;

    for (let i = 0; i < maxAttempts; i++) {
        const seed32 = randomBytes32OrThrow();
        const kp = nacl.sign.keyPair.fromSeed(seed32);
        const pubRaw32 = kp.publicKey;
        const onion = deriveOnionFromPub(pubRaw32);
        if (!want || onion.startsWith(want)) {
            return {
                onion,
                seed_hex: bytesToHex(seed32),
                pub_hex: bytesToHex(pubRaw32),
                attempts: i + 1,
            };
        }
    }

    throw new Error('vanity not found within maxAttempts');
}

module.exports = {
    generateV3OnionVanity,
};
