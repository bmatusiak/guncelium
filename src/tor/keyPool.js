export const GUN_TOR_KEY_POOL = Object.freeze([
    {
        onion: 'gunndtaowywwyo3tkjshbupdow7gghje5tqp2jlhh6ojhd7eekchnlid',
        seed_hex: '4f787ab83399f7641fa128f427f92cba99b41171cd17d51eb41f3db5be2e9c7b',
        pub_hex: '351ad1cc0eb62d6c3b73526470d1e375be631d24ece0fd25673f9c938fe42284',
        generate: false,
    },
    {
        onion: 'guncoqtncvs6f5targrksdhpthwy3yyulcq5adjy2x4tbnhgopl2epid',
        seed_hex: '8149d328f07c942f6783ebcff0b9f6486a2e72117cf9446dc3b262088d52b121',
        pub_hex: '351a27426d1565e2f66089a2a90cef99ed8de31458a1d00d38d5f930b4e673d7',
        generate: false,
    },
    {
        onion: 'gunzuct55pmmmr6l2caxws3nvmaft4stngb5qiwlru3u5sdmv3olblyd',
        seed_hex: '37e7605f36cb3d0f5cea86f1c086cf68b29f461b237c5f3c8b5642f57e9f0932',
        pub_hex: '351b9a0a7debd8c647cbd0817b4b6dab0059f2536983d822cb8d374ec86caedc',
        generate: false,
    },
    {
        onion: 'gunrbhuxaswhp4ky6puq53i3rlzyrebezhknsnf7s3xcpyojoenubbyd',
        seed_hex: '633c3ccd84687a7099cdd4584a70a3701f8f687354788cfe5012db9f71e24743',
        pub_hex: '351b109e9704ac77f158f3e90eed1b8af3889024c9d4d934bf96ee27e1c9711b',
        generate: false,
    },
    {
        onion: 'gunz53jxivvg5lqgqd4osifkg32vr7n7fwfdo6jqx4u5jtsvfnqh3dqd',
        seed_hex: 'fc226a8fd88b5862dc1f12e2694c5814710379fc4101e3e9a05590e3c649c77c',
        pub_hex: '351b9eed37456a6eae0680f8e920aa36f558fdbf2d8a377930bf29d4ce552b60',
        generate: false,
    },
]);

function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

function requireArray(value, name) {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
}

function requirePositiveInt(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
    return n;
}

function validateKeyOrThrow(key, name) {
    requireObject(key, name);
    requireString(key.onion, `${name}.onion`);
    requireString(key.seed_hex, `${name}.seed_hex`);
    requireString(key.pub_hex, `${name}.pub_hex`);
    if (key.generate !== false) throw new Error(`${name}.generate must be false for pool keys`);
}

function pickIndexOrThrow(maxExclusive) {
    const n = requirePositiveInt(maxExclusive, 'maxExclusive');
    // Availability: Math.random exists on all supported runtimes here.
    const r = Math.random();
    if (!Number.isFinite(r) || r < 0 || r >= 1) throw new Error('Math.random returned invalid value');
    const idx = Math.floor(r * n);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) throw new Error('computed random index out of bounds');
    return idx;
}

export function pickGunTorHostingKeysOrThrow(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const pool = (o.pool === undefined || o.pool === null) ? GUN_TOR_KEY_POOL : o.pool;
    requireArray(pool, 'opts.pool');
    if (pool.length < 1) throw new Error('opts.pool must have at least 1 key');

    const bootstrapCount = (o.bootstrapCount === undefined || o.bootstrapCount === null) ? 1 : requirePositiveInt(o.bootstrapCount, 'opts.bootstrapCount');
    if (bootstrapCount > pool.length) throw new Error('opts.bootstrapCount must be <= pool.length');

    for (let i = 0; i < pool.length; i++) validateKeyOrThrow(pool[i], `keyPool[${i}]`);

    const chosen = [];
    const chosenIdx = [];

    // Choose distinct bootstrap keys (bounded by pool length).
    for (let i = 0; i < bootstrapCount; i++) {
        let idx = pickIndexOrThrow(pool.length);
        // bounded retry: at most pool.length attempts to find a new index
        for (let j = 0; j < pool.length; j++) {
            if (!chosenIdx.includes(idx)) break;
            idx = (idx + 1) % pool.length;
        }
        if (chosenIdx.includes(idx)) throw new Error('failed to pick unique bootstrap key');
        chosenIdx.push(idx);
        chosen.push(pool[idx]);
    }

    const includeRandom = (o.includeRandom === undefined || o.includeRandom === null) ? true : (o.includeRandom === true);
    const maxAttempts = (o.maxAttempts === undefined || o.maxAttempts === null) ? 250000 : requirePositiveInt(o.maxAttempts, 'opts.maxAttempts');

    if (includeRandom) {
        chosen.push({ generate: true, maxAttempts });
    }

    return chosen;
}
