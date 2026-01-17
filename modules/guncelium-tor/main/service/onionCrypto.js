const crypto = require('crypto');
const { sha3_256: sha3_256_js } = require('js-sha3');

function sha3_256(buf) {
    if (!buf) throw new Error('buf is required');
    // Use a pure-JS SHA3-256 implementation to avoid OpenSSL/Node build differences.
    // Returns a Buffer.
    const ab = sha3_256_js.arrayBuffer(buf);
    return Buffer.from(ab);
}

function base32Encode(buf) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < buf.length; i++) {
        value = (value << 8) | buf[i];
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

function rawPublicKeyFromSpki(spkiDer) {
    return Buffer.from(spkiDer.slice(-32));
}

function pkcs8SeedFromDer(pkcs8) {
    for (let i = 0; i <= pkcs8.length - 34; i++) {
        if (pkcs8[i] === 0x04 && pkcs8[i + 1] === 0x20) {
            return pkcs8.slice(i + 2, i + 2 + 32);
        }
    }
    throw new Error('failed to find seed in pkcs8');
}

function expandSeedToSecret(seed32) {
    const h = crypto.createHash('sha512').update(seed32).digest();
    h[0] &= 248;
    h[31] &= 127;
    h[31] |= 64;
    return h;
}

function deriveOnionFromPub(pubRaw32) {
    const version = Buffer.from([0x03]);
    const checksum = sha3_256(Buffer.concat([Buffer.from('.onion checksum'), pubRaw32, version])).slice(0, 2);
    const addrBytes = Buffer.concat([pubRaw32, checksum, version]);
    return base32Encode(addrBytes); // no .onion suffix
}

function generateOnionKeypairVanity(keyword, maxAttempts) {
    const attemptsMax = Number(maxAttempts) > 0 ? Number(maxAttempts) : 250000;
    const want = keyword ? String(keyword).toLowerCase() : null;
    for (let i = 0; i < attemptsMax; i++) {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        const pubDer = publicKey.export({ type: 'spki', format: 'der' });
        const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
        const pubRaw = rawPublicKeyFromSpki(pubDer);
        const onion = deriveOnionFromPub(pubRaw);
        if (!want || onion.startsWith(want)) return { onion, pubRaw, privDer, attempts: i + 1 };
    }
    throw new Error('vanity not found within maxAttempts');
}

module.exports = {
    sha3_256,
    base32Encode,
    rawPublicKeyFromSpki,
    pkcs8SeedFromDer,
    expandSeedToSecret,
    deriveOnionFromPub,
    generateOnionKeypairVanity,
};
