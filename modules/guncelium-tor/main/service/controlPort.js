const net = require('net');
const fs = require('fs');

function hex(buf) {
    return Buffer.from(buf).toString('hex');
}

function parseProtocolInfo(text) {
    const res = { raw: text, methods: [], cookieFile: null };
    const m = text.match(/250-AUTH\s+METHODS=([^\s]+)(?:\s+COOKIEFILE="([^"]+)")?/);
    if (m) {
        res.methods = String(m[1] || '').split(',').map(s => s.trim()).filter(Boolean);
        res.cookieFile = m[2] || null;
    }
    return res;
}

function parseGetInfoReply(text) {
    // Supports both single-line (250-key=val) and multi-line (250+key=...\n.\n250 OK)
    const out = { raw: text, values: {} };
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const single = line.match(/^250-([^=]+)=(.*)$/);
        if (single) {
            out.values[single[1]] = single[2];
            continue;
        }
        const multi = line.match(/^250\+([^=]+)=(.*)$/);
        if (multi) {
            const key = multi[1];
            const buf = [multi[2]];
            i++;
            for (; i < lines.length; i++) {
                if (lines[i] === '.') break;
                buf.push(lines[i]);
            }
            out.values[key] = buf.join('\n');
        }
    }
    return out;
}

async function controlPortRequest({ host = '127.0.0.1', port = 9051, timeoutMs = 1500, commands = [] }) {
    return await new Promise((resolve) => {
        const sock = net.createConnection({ host, port });
        let buf = '';
        let done = false;
        let stage = 0;
        const replies = [];

        const finish = (res) => {
            if (done) return;
            done = true;
            sock.destroy();
            resolve(res);
        };

        sock.setTimeout(timeoutMs);
        sock.on('timeout', () => finish({ ok: false, error: 'timeout' }));
        sock.on('error', (e) => finish({ ok: false, error: e && e.message ? e.message : String(e) }));
        sock.on('connect', () => {
            try { sock.write('PROTOCOLINFO 1\r\n'); } catch (e) { finish({ ok: false, error: String(e) }); }
        });
        sock.on('data', (d) => {
            buf += d.toString('utf8');
            if (!buf.includes('\n250 OK') && !buf.trimEnd().endsWith('250 OK')) return;

            const reply = buf;
            buf = '';

            if (stage === 0) {
                const pi = parseProtocolInfo(reply);
                stage = 1;

                // Authenticate if COOKIE/SAFECOOKIE is configured.
                if (pi.methods.includes('COOKIE') && pi.cookieFile && fs.existsSync(pi.cookieFile)) {
                    try {
                        const cookie = fs.readFileSync(pi.cookieFile);
                        sock.write(`AUTHENTICATE ${hex(cookie)}\r\n`);
                        stage = 2;
                        return;
                    } catch (e) {
                        return finish({ ok: false, error: `failed to authenticate with cookie: ${e.message}` });
                    }
                }

                // No auth required or cookie missing; try empty AUTHENTICATE.
                try {
                    sock.write('AUTHENTICATE\r\n');
                    stage = 2;
                } catch (e) {
                    finish({ ok: false, error: String(e), protocolinfo: pi });
                }
                return;
            }

            if (stage === 2) {
                // AUTHENTICATE response
                if (!reply.includes('250 OK')) return finish({ ok: false, error: 'controlport authentication failed' });
                stage = 3;
                if (!commands.length) return finish({ ok: true, replies: [] });
                try {
                    sock.write(commands[0] + '\r\n');
                } catch (e) {
                    finish({ ok: false, error: String(e) });
                }
                return;
            }

            if (stage >= 3) {
                const idx = stage - 3;
                replies[idx] = reply;

                const nextIdx = idx + 1;
                if (nextIdx >= commands.length) {
                    return finish({ ok: true, replies });
                }
                stage++;
                try {
                    sock.write(commands[nextIdx] + '\r\n');
                } catch (e) {
                    finish({ ok: false, error: String(e), replies });
                }
            }
        });
    });
}

async function controlPortProtocolInfo(host = '127.0.0.1', port = 9051, timeoutMs = 1000) {
    return await new Promise((resolve) => {
        const sock = net.createConnection({ host, port });
        let buf = '';
        let done = false;

        const finish = (res) => {
            if (done) return;
            done = true;
            sock.destroy();
            resolve(res);
        };

        sock.setTimeout(timeoutMs);
        sock.on('timeout', () => finish({ ok: false, error: 'timeout' }));
        sock.on('error', (e) => finish({ ok: false, error: e && e.message ? e.message : String(e) }));
        sock.on('connect', () => {
            try { sock.write('PROTOCOLINFO 1\r\n'); } catch (e) { finish({ ok: false, error: String(e) }); }
        });
        sock.on('data', (d) => {
            buf += d.toString('utf8');
            if (buf.includes('250 OK')) finish({ ok: true, protocolinfo: buf });
        });
    });
}

async function controlPortGetInfo({ host = '127.0.0.1', port = 9051, timeoutMs = 1500, keys = [] }) {
    const cmds = keys.map(k => `GETINFO ${k}`);
    const r = await controlPortRequest({ host, port, timeoutMs, commands: cmds });
    if (!r.ok) return r;

    const info = {};
    for (let i = 0; i < keys.length; i++) {
        const parsed = parseGetInfoReply(r.replies[i] || '');
        const key = keys[i];
        // Tor echoes the key name in the reply; keep whatever it used.
        const found = Object.prototype.hasOwnProperty.call(parsed.values, key) ? key : Object.keys(parsed.values)[0];
        info[key] = found ? parsed.values[found] : null;
    }
    return { ok: true, info, raw: r.replies };
}

function parseOnionList(value) {
    if (!value) return [];
    // Common formats: comma-separated, space-separated, or newline-separated.
    return String(value)
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/\.onion$/i, '').toLowerCase());
}

async function controlPortGetOnions({ host = '127.0.0.1', port = 9051, timeoutMs = 1500 }) {
    // Try a few keys; Tor versions differ.
    const candidates = [
        'onions/current',
        'onions/detached',
        // keep a couple legacy-ish fallbacks; harmless if unsupported
        'onion-service/all',
        'onion-services',
    ];

    // First: prove the control port is reachable/authenticated.
    const ping = await controlPortGetInfo({ host, port, timeoutMs, keys: ['version'] });
    if (!ping.ok) {
        return { ok: false, onions: [], usedKey: null, error: ping.error || 'controlport unreachable' };
    }

    const out = { ok: true, onions: [], usedKey: null, error: null };

    for (const key of candidates) {
        const r = await controlPortGetInfo({ host, port, timeoutMs, keys: [key] });
        if (!r.ok) {
            out.error = r.error;
            continue;
        }
        // If key is unsupported Tor returns something like 552 Unrecognized key.
        if (typeof r.raw?.[0] === 'string' && r.raw[0].includes('552')) continue;

        const list = parseOnionList(r.info[key]);
        out.usedKey = key;
        out.onions = list;
        return out;
    }

    out.error = out.error || 'no supported onion list key (control port reachable)';
    return out;
}

module.exports = { controlPortProtocolInfo, controlPortRequest, controlPortGetInfo, controlPortGetOnions };
