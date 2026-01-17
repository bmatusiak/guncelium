const fs = require('fs');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function tryChmod(p, mode) {
    fs.chmodSync(p, mode);
}

function safeUnlink(p) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { ensureDir, tryChmod, safeUnlink };
