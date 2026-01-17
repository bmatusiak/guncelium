const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { ensureDir } = require('./fsUtil');
const { getTorPaths } = require('./paths');

function startTorProcess({ app, torPath, args = [] }) {
    const { torDir, logFile } = getTorPaths(app);

    ensureDir(torDir);

    let torLastError = null;
    let lastExit = null;
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const cwd = path.dirname(torPath);

    const child = spawn(torPath, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    if (child.stdout) {
        child.stdout.on('data', (d) => {
            logStream.write(d);
        });
    }
    if (child.stderr) {
        child.stderr.on('data', (d) => {
            logStream.write(d);
            torLastError = d.toString('utf8');
        });
    }

    child.on('exit', (code, signal) => {
        lastExit = { code, signal, ts: Date.now() };
        logStream.end();
    });

    return {
        child,
        getLastError: () => torLastError,
        getLastExit: () => lastExit,
        logFile,
    };
}

module.exports = { startTorProcess };
