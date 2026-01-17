const fs = require('fs');

function ensureMinimalTorrc({ torrcPath, dataDir }) {
    if (!torrcPath) throw new Error('torrcPath is required');
    if (!dataDir) throw new Error('dataDir is required');
    if (fs.existsSync(torrcPath)) return;
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const lines = [
        'SocksPort 0',
        'RunAsDaemon 0',
        `DataDirectory ${dataDir}`,
        'Log notice stdout',
    ];
    fs.writeFileSync(torrcPath, lines.join('\n') + '\n', { encoding: 'utf8' });
}

function writeMinimalTorrc({ torrcPath, dataDir }) {
    if (!torrcPath) throw new Error('torrcPath is required');
    if (!dataDir) throw new Error('dataDir is required');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const lines = [
        'SocksPort 0',
        'RunAsDaemon 0',
        `DataDirectory ${dataDir}`,
        'Log notice stdout',
    ];
    fs.writeFileSync(torrcPath, lines.join('\n') + '\n', { encoding: 'utf8' });
}

function sanitizeTorrc({ torrcPath, dataDir }) {
    if (!torrcPath) throw new Error('torrcPath is required');
    if (!dataDir) throw new Error('dataDir is required');
    if (!fs.existsSync(torrcPath)) return;
    const raw = fs.readFileSync(torrcPath, 'utf8') || '';
    const hasHsDir = /^(\s*)HiddenServiceDir\b/m.test(raw);
    const hasHsPort = /^(\s*)HiddenServicePort\b/m.test(raw);

    // Tor refuses to start if a HS dir exists with no ports configured.
    // Fail-fast: do not auto-rewrite the user's torrc.
    if (hasHsDir && !hasHsPort) {
        throw new Error('invalid torrc: HiddenServiceDir present without HiddenServicePort');
    }
}

function cleanupHiddenServices({ hsBaseDir, hiddenServicesResultsFile }) {
    if (!hsBaseDir) throw new Error('hsBaseDir is required');
    if (!hiddenServicesResultsFile) throw new Error('hiddenServicesResultsFile is required');
    fs.rmSync(hsBaseDir, { recursive: true, force: true });
    fs.rmSync(hiddenServicesResultsFile, { force: true });
}

module.exports = {
    ensureMinimalTorrc,
    writeMinimalTorrc,
    sanitizeTorrc,
    cleanupHiddenServices,
};
