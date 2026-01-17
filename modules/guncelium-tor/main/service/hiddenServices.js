const fs = require('fs');
const path = require('path');
const { ensureDir, tryChmod, safeUnlink } = require('./fsUtil');
const { getTorPaths } = require('./paths');
const { pkcs8SeedFromDer, expandSeedToSecret, deriveOnionFromPub, generateOnionKeypairVanity } = require('./onionCrypto');
const { controlPortGetOnions } = require('./controlPort');

function writeHiddenServiceKeysExpanded(hsDir, expandedSecret64) {
    ensureDir(hsDir);
    tryChmod(hsDir, 0o700);

    const secHeader = Buffer.from('== ed25519v1-secret: type0 ==\0\0\0');
    const secPath = path.join(hsDir, 'hs_ed25519_secret_key');

    safeUnlink(path.join(hsDir, 'hs_ed25519_public_key'));
    safeUnlink(path.join(hsDir, 'hostname'));

    fs.writeFileSync(secPath, Buffer.concat([secHeader, expandedSecret64]));
    tryChmod(secPath, 0o600);

    return secPath;
}

function buildTorrc({ dataDir, enableControlPort, hsEntries }) {
    void enableControlPort;
    const lines = [
        'SocksPort 9050',
        'SocksListenAddress 127.0.0.1',
        // ControlPort is configured via CLI args so we can pick a free port on restart.
        'ControlPort 0',
        'RunAsDaemon 0',
        `DataDirectory ${dataDir}`,
        'Log notice stdout',
    ].filter(Boolean);

    for (const entry of hsEntries) {
        lines.push(`HiddenServiceDir ${entry.dir}`);
        lines.push('HiddenServiceVersion 3');
        if (entry.localPort) lines.push(`HiddenServicePort ${entry.virtualPort} 127.0.0.1:${entry.localPort}`);
    }

    return lines.join('\n') + '\n';
}

function createHiddenServices({ app, keys, localPort, virtualPort = 80, serviceName = null, enableControlPort = false }) {
    const { torDir, hsBaseDir, dataDir, torrcPath, hiddenServicesResultsFile } = getTorPaths(app);

    if (!localPort) {
        return { ok: false, error: 'localPort is required to configure HiddenServicePort' };
    }

    if (!Array.isArray(keys)) {
        return { ok: false, error: 'keys must be an array' };
    }
    if (keys.length < 1) {
        return { ok: false, error: 'keys must contain at least one entry (use [{}] to let Tor generate keys)' };
    }

    ensureDir(torDir);
    // Clear old hidden services to avoid stale/invalid configs breaking Tor startup.
    fs.rmSync(hsBaseDir, { recursive: true, force: true });
    ensureDir(hsBaseDir);
    ensureDir(dataDir);
    tryChmod(torDir, 0o700);
    tryChmod(hsBaseDir, 0o700);
    tryChmod(dataDir, 0o700);

    const results = [];
    const hsEntries = [];

    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const hsDir = path.join(hsBaseDir, `hs${i + 1}`);
        ensureDir(hsDir);
        tryChmod(hsDir, 0o700);

        let onionExpected = null;
        let seedHex = null;
        let pubHex = null;
        let attempts = null;

        try {
            if (k && k.generate) {
                const vanity = (k && k.vanity) ? String(k.vanity) : null;
                const maxAttempts = (k && k.maxAttempts) ? Number(k.maxAttempts) : 250000;
                const gen = generateOnionKeypairVanity(vanity, maxAttempts);
                const seed = pkcs8SeedFromDer(gen.privDer);
                const expanded = expandSeedToSecret(seed);
                writeHiddenServiceKeysExpanded(hsDir, expanded);
                onionExpected = gen.onion;
                seedHex = seed.toString('hex');
                pubHex = gen.pubRaw.toString('hex');
                attempts = gen.attempts;
            } else if (k && k.seed_hex) {
                const seed = Buffer.from(String(k.seed_hex), 'hex');
                if (seed.length !== 32) throw new Error('seed_hex must be 32 bytes');
                const expanded = expandSeedToSecret(seed);
                writeHiddenServiceKeysExpanded(hsDir, expanded);
                seedHex = seed.toString('hex');
                if (k.pub_hex) pubHex = String(k.pub_hex);
                if (pubHex && pubHex.length === 64) onionExpected = deriveOnionFromPub(Buffer.from(pubHex, 'hex'));
            }

            hsEntries.push({ dir: hsDir, localPort, virtualPort });
            results.push({
                key: k,
                ok: true,
                dir: hsDir,
                service: serviceName,
                localPort,
                virtualPort,
                onion_expected: onionExpected,
                seed_hex: seedHex,
                pub_hex: pubHex,
                attempts,
            });
        } catch (e) {
            results.push({ key: k, ok: false, dir: hsDir, service: serviceName, error: e.message });
        }
    }

    const torrc = buildTorrc({ dataDir, enableControlPort, hsEntries });
    fs.writeFileSync(torrcPath, torrc, { encoding: 'utf8' });

    fs.writeFileSync(hiddenServicesResultsFile, JSON.stringify({
        ts: Date.now(),
        localPort,
        virtualPort,
        service: serviceName,
        results,
    }, null, 2), { encoding: 'utf8' });

    return { ok: true, results };
}

async function readHiddenServicesStatus({ app, torChild, torLogFile, torLastError, controlHost = '127.0.0.1', controlPort = 9051 }) {
    const { hiddenServicesResultsFile, torrcPath } = getTorPaths(app);
    const childRunning = !!(torChild && !torChild.killed);

    const activeHsDirs = (() => {
        if (!fs.existsSync(torrcPath)) return [];
        const raw = fs.readFileSync(torrcPath, 'utf8') || '';
        const dirs = [];
        raw.split(/\r?\n/).forEach((line) => {
            const m = String(line).match(/^\s*HiddenServiceDir\s+(.+?)\s*$/);
            if (m && m[1]) dirs.push(m[1]);
        });
        return dirs;
    })();

    // Prefer ControlPort to determine “Tor running”, because Tor may be started outside this app.
    let control = { ok: false, onions: [], usedKey: null, error: null };
    try {
        control = await controlPortGetOnions({ host: controlHost, port: controlPort, timeoutMs: 1200 });
    } catch (e) {
        control = { ok: false, onions: [], usedKey: null, error: e.message };
    }

    const torRunning = childRunning || !!control.ok;

    if (!fs.existsSync(hiddenServicesResultsFile)) return { ok: true, ts: null, results: [], torRunning, controlPort: { ok: !!control.ok, usedKey: control.usedKey, onions: control.onions, error: control.error } };

    const parsed = JSON.parse(fs.readFileSync(hiddenServicesResultsFile, 'utf8') || '{}');

    if (!torRunning) {
        return {
            ok: true,
            ts: parsed.ts || null,
            localPort: parsed.localPort || null,
            virtualPort: parsed.virtualPort || null,
            service: parsed.service || null,
            torRunning: false,
            torLogFile,
            torLastError,
            controlPort: {
                ok: !!control.ok,
                usedKey: control.usedKey,
                onions: control.onions,
                error: control.error,
            },
            results: [],
        };
    }

    // Only report currently-active services (i.e., those present in torrc right now).
    // This prevents Tor from “remembering” old Gun attachments in the UI.
    let results = parsed.results || [];
    if (activeHsDirs.length) {
        results = results.filter(r => r && r.dir && activeHsDirs.includes(r.dir));
    } else {
        results = [];
    }

    for (const r of results) {
        if (!r || !r.dir) continue;

        // First: try to take onion from ControlPort output when possible.
        // If we know the expected onion, we can mark it “active” without reading filesystem.
        const expected = r.onion_expected ? String(r.onion_expected).toLowerCase() : null;
        if (expected && Array.isArray(control.onions) && control.onions.includes(expected)) {
            r.onion = expected;
            r.onion_from_control = true;
        }

        // Read hostname file (created by tor when HS is loaded)
        if (!r.onion) {
            const hostnameFile = path.join(r.dir, 'hostname');
            if (fs.existsSync(hostnameFile)) {
                const hn = fs.readFileSync(hostnameFile, 'utf8').trim();
                if (hn) r.onion = hn.replace(/\.onion$/, '');
            }
        }
        const secretFile = path.join(r.dir, 'hs_ed25519_secret_key');
        r.private_present = fs.existsSync(secretFile);
        if (r.onion && r.onion_expected) r.onion_match = (String(r.onion) === String(r.onion_expected));
    }

    return {
        ok: true,
        ts: parsed.ts || null,
        localPort: results.length ? (parsed.localPort || null) : null,
        virtualPort: results.length ? (parsed.virtualPort || null) : null,
        service: results.length ? (parsed.service || null) : null,
        torRunning,
        torLogFile,
        torLastError,
        controlPort: {
            ok: !!control.ok,
            usedKey: control.usedKey,
            onions: control.onions,
            error: control.error,
        },
        results,
    };
}

module.exports = { createHiddenServices, readHiddenServicesStatus };
