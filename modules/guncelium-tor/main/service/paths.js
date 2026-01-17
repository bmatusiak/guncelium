const path = require('path');

function getTorBaseDir(app) {
    const userData = app.getPath('userData');
    return path.join(userData, 'tor');
}

function getTorPaths(app) {
    const torDir = getTorBaseDir(app);
    return {
        torDir,
        installMetaFile: path.join(torDir, 'install.json'),
        torrcPath: path.join(torDir, 'torrc'),
        dataDir: path.join(torDir, 'tor-run'),
        hsBaseDir: path.join(torDir, 'hidden_services'),
        hiddenServicesFile: path.join(torDir, 'hidden_services.json'),
        hiddenServicesResultsFile: path.join(torDir, 'hidden_services_results.json'),
        logFile: path.join(torDir, 'tor.log'),
    };
}

module.exports = { getTorBaseDir, getTorPaths };
