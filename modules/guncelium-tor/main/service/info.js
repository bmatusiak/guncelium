const fs = require('fs');
const path = require('path');
const { getTorPaths } = require('./paths');
const { walkDir, chooseBestTorBin } = require('./installer');

async function getTorInfo({ app, torChild }) {
    const { torDir, installMetaFile } = getTorPaths(app);

    if (!fs.existsSync(torDir)) {
        return { installed: false, running: !!(torChild && !torChild.killed) };
    }

    let version = null;
    let torPath = null;

    if (fs.existsSync(installMetaFile)) {
        const meta = JSON.parse(fs.readFileSync(installMetaFile, 'utf8') || '{}');
        version = meta.version || null;
        torPath = meta.path || null;
    }

    if (!torPath) {
        const files = walkDir(torDir);
        const torBins = files.filter(f => ['tor', 'tor.exe'].includes(path.basename(f).toLowerCase()));
        if (torBins.length) torPath = chooseBestTorBin(torBins) || torBins[0];
    }

    const running = !!(torChild && !torChild.killed);
    const pid = running ? torChild.pid : null;

    return { installed: true, version, path: torPath, running, pid };
}

module.exports = { getTorInfo };
