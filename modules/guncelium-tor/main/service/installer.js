const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { ensureDir } = require('./fsUtil');
const { getTorPaths } = require('./paths');

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15000;

function isRedirectStatus(statusCode) {
    return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function fetchText(url) {
    if (!url || typeof url !== 'string') throw new Error('fetchText url is required');
    let currentUrl = url;

    for (let i = 0; i < MAX_REDIRECTS; i++) {
        // eslint-disable-next-line no-await-in-loop
        const result = await new Promise((resolve, reject) => {
            const req = https.get(currentUrl, {
                headers: {
                    'User-Agent': 'my-new-app/tor-installer',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: DEFAULT_TIMEOUT_MS,
            }, (res) => {
                const status = res.statusCode || 0;
                if (isRedirectStatus(status) && res.headers && res.headers.location) {
                    const nextUrl = new URL(res.headers.location, currentUrl).toString();
                    res.resume();
                    resolve({ redirect: nextUrl });
                    return;
                }
                if (status < 200 || status >= 300) {
                    res.resume();
                    reject(new Error(`HTTP ${status} fetching ${currentUrl}`));
                    return;
                }

                res.setEncoding('utf8');
                let data = '';
                res.on('data', (d) => { data += d; });
                res.on('end', () => resolve({ text: data }));
            });
            req.on('timeout', () => req.destroy(new Error(`timeout fetching ${currentUrl}`)));
            req.on('error', reject);
        });

        if (result && result.redirect) {
            currentUrl = result.redirect;
            continue;
        }
        if (result && typeof result.text === 'string') return result.text;
        throw new Error('fetchText internal error');
    }

    throw new Error(`too many redirects fetching ${url}`);
}

async function download(url, dest) {
    if (!url || typeof url !== 'string') throw new Error('download url is required');
    if (!dest || typeof dest !== 'string') throw new Error('download dest is required');
    let currentUrl = url;

    for (let i = 0; i < MAX_REDIRECTS; i++) {
        // eslint-disable-next-line no-await-in-loop
        const result = await new Promise((resolve, reject) => {
            const req = https.get(currentUrl, {
                headers: {
                    'User-Agent': 'my-new-app/tor-installer',
                    'Accept': '*/*'
                },
                timeout: DEFAULT_TIMEOUT_MS,
            }, (res) => {
                const status = res.statusCode || 0;
                if (isRedirectStatus(status) && res.headers && res.headers.location) {
                    const nextUrl = new URL(res.headers.location, currentUrl).toString();
                    res.resume();
                    resolve({ redirect: nextUrl });
                    return;
                }
                if (status < 200 || status >= 300) {
                    res.resume();
                    reject(new Error(`HTTP ${status} downloading ${currentUrl}`));
                    return;
                }

                const f = fs.createWriteStream(dest);
                f.on('error', (e) => reject(e));
                res.pipe(f);
                f.on('finish', () => {
                    f.close(() => resolve({ path: dest }));
                });
            });
            req.on('timeout', () => req.destroy(new Error(`timeout downloading ${currentUrl}`)));
            req.on('error', reject);
        });

        if (result && result.redirect) {
            currentUrl = result.redirect;
            continue;
        }
        if (result && result.path) return result.path;
        throw new Error('download internal error');
    }

    throw new Error(`too many redirects downloading ${url}`);
}

function parseTorArchiveVersionsOrThrow(indexHtml) {
    if (typeof indexHtml !== 'string' || indexHtml.length === 0) throw new Error('indexHtml is required');

    const found = new Set();
    // Common Apache directory listing: <a href="14.0.2/">14.0.2/</a>
    for (const m of indexHtml.matchAll(/href="([0-9]+(?:\.[0-9]+)*)\//g)) {
        if (m && m[1]) found.add(m[1]);
    }
    // Some listings might only contain text nodes like >14.0.2/<
    for (const m of indexHtml.matchAll(/>([0-9]+(?:\.[0-9]+)*)\//g)) {
        if (m && m[1]) found.add(m[1]);
    }

    const versions = Array.from(found);
    if (!versions.length) throw new Error('no versions found in tor archive index');
    versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return versions;
}

function walkDir(p) {
    const MAX_ENTRIES = 100000;
    if (!p || typeof p !== 'string') throw new Error('walkDir path is required');

    const out = [];
    const stack = [p];
    let seen = 0;

    while (stack.length) {
        const dir = stack.pop();
        seen++;
        if (seen > MAX_ENTRIES) throw new Error(`walkDir exceeded MAX_ENTRIES=${MAX_ENTRIES}`);

        const names = fs.readdirSync(dir);
        for (let i = 0; i < names.length; i++) {
            const fp = path.join(dir, names[i]);
            const st = fs.statSync(fp);
            if (st.isDirectory()) stack.push(fp);
            else out.push(fp);
        }
    }

    return out;
}

function chooseBestTorBin(files) {
    if (!files || !files.length) return null;
    const norm = p => p.replace(/\\/g, '/').toLowerCase();
    const score = (p) => {
        const np = norm(p);
        if (np.includes('/debug/')) return 100;
        if (np.endsWith('/tor') || np.endsWith('/tor.exe')) return 5;
        if (np.includes('/tor/tor/tor')) return 0;
        if (np.includes('/tor/tor')) return 1;
        if (np.includes('debug')) return 50;
        return 10;
    };
    return files.slice().sort((a, b) => score(a) - score(b))[0] || null;
}

async function installTor({ app, version: versionOpt } = {}) {
    const { torDir, installMetaFile } = getTorPaths(app);

    const platform = os.platform();
    const arch = os.arch();

    let version = versionOpt;
    if (!version) {
        const INDEX_URL = 'https://archive.torproject.org/tor-package-archive/torbrowser/';
        const idx = await fetchText(INDEX_URL);
        const versions = parseTorArchiveVersionsOrThrow(idx);
        version = versions[versions.length - 1];
    }
    if (!version) return { ok: false, error: 'could not determine tor version' };

    const archiveBase = `https://archive.torproject.org/tor-package-archive/torbrowser/${version}/`;
    let fname = null;
    if (platform === 'linux') {
        if (arch === 'x64' || arch === 'x86_64') fname = `tor-expert-bundle-linux-x86_64-${version}.tar.gz`;
        else if (arch === 'arm64' || arch === 'aarch64') fname = `tor-expert-bundle-linux-aarch64-${version}.tar.gz`;
        else return { ok: false, error: `unsupported arch: ${arch}` };
    } else if (platform === 'win32') {
        fname = `tor-expert-bundle-windows-x86_64-${version}.zip`;
    } else if (platform === 'darwin') {
        fname = `tor-expert-bundle-osx-x86_64-${version}.tar.gz`;
    } else {
        return { ok: false, error: `unsupported platform: ${platform}` };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tor-'));
    const url = archiveBase + fname;
    const downloaded = await download(url, path.join(tmpDir, fname));

    fs.rmSync(torDir, { recursive: true, force: true });
    ensureDir(torDir);

    if (downloaded.endsWith('.tar.gz') || downloaded.endsWith('.tgz')) {
        const r = spawnSync('tar', ['-xzf', downloaded, '-C', torDir]);
        if (r.status !== 0) throw new Error(r.stderr ? r.stderr.toString() : 'tar failed');
    } else if (downloaded.endsWith('.zip')) {
        const r = spawnSync('unzip', [downloaded, '-d', torDir]);
        if (r.status !== 0) throw new Error(r.stderr ? r.stderr.toString() : 'unzip failed');
    }

    const files = walkDir(torDir);
    const torBins = files.filter(f => ['tor', 'tor.exe'].includes(path.basename(f).toLowerCase()));

    let best = null;
    if (torBins.length) {
        best = chooseBestTorBin(torBins) || torBins[0];
        fs.chmodSync(best, 0o755);
    }

    const meta = { path: best || torDir, version };
    fs.writeFileSync(installMetaFile, JSON.stringify(meta, null, 2), { encoding: 'utf8' });

    return { ok: true, path: meta.path, version };
}

module.exports = { installTor, walkDir, chooseBestTorBin };
