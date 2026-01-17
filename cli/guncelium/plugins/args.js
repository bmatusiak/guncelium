'use strict';

setup.consumes = [];
setup.provides = ['args'];

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requireInteger(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
    return n;
}

function parseArgvOrThrow(argv) {
    if (!Array.isArray(argv)) throw new Error('argv must be an array');

    const out = {
        command: null,
        flags: Object.create(null),
    };

    const args = argv.slice(0);
    if (args.length === 0) {
        out.command = 'help';
        return out;
    }

    if (!args[0].startsWith('-')) {
        out.command = String(args.shift());
    } else {
        out.command = 'help';
    }

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a !== 'string') throw new Error('argv items must be strings');
        if (!a.startsWith('--')) throw new Error(`unexpected arg: ${a} (only --flags supported)`);

        const eq = a.indexOf('=');
        if (eq !== -1) {
            const k = a.slice(2, eq);
            const v = a.slice(eq + 1);
            requireString(k, 'flag');
            out.flags[k] = v;
            continue;
        }

        const key = a.slice(2);
        requireString(key, 'flag');

        const next = args[i + 1];
        if (next !== undefined && typeof next === 'string' && !next.startsWith('--')) {
            out.flags[key] = next;
            i++;
        } else {
            out.flags[key] = true;
        }
    }

    // normalize common numeric flags
    if (out.flags['gun-port'] !== undefined && out.flags['gun-port'] !== true) {
        out.flags['gun-port'] = requireInteger(out.flags['gun-port'], '--gun-port');
    }
    if (out.flags['virtual-port'] !== undefined && out.flags['virtual-port'] !== true) {
        out.flags['virtual-port'] = requireInteger(out.flags['virtual-port'], '--virtual-port');
    }

    return out;
}

function setup(_imports, register) {
    if (typeof register !== 'function') throw new Error('register must be a function');
    const parsed = parseArgvOrThrow(process.argv.slice(2));
    register(null, { args: parsed });
}

module.exports = setup;
