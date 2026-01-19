'use strict';

// Shared, fixed bootstrap key pool for the Tor+Gun protocol.
// These keys are intentionally stable to reduce discovery/bootstrapping friction.
//
// SECURITY NOTE:
// Storing private key material (seed_hex) in source control means anyone can impersonate
// these onion identities. Only use this for public bootstrap identities where that is acceptable.

module.exports = Object.freeze({
    GUN_BOOTSTRAP_KEY_POOL: Object.freeze([
        Object.freeze({
            onion: 'gunndtaowywwyo3tkjshbupdow7gghje5tqp2jlhh6ojhd7eekchnlid',
            seed_hex: '4f787ab83399f7641fa128f427f92cba99b41171cd17d51eb41f3db5be2e9c7b',
            pub_hex: '351ad1cc0eb62d6c3b73526470d1e375be631d24ece0fd25673f9c938fe42284',
            generate: false,
        }),
        Object.freeze({
            onion: 'guncoqtncvs6f5targrksdhpthwy3yyulcq5adjy2x4tbnhgopl2epid',
            seed_hex: '8149d328f07c942f6783ebcff0b9f6486a2e72117cf9446dc3b262088d52b121',
            pub_hex: '351a27426d1565e2f66089a2a90cef99ed8de31458a1d00d38d5f930b4e673d7',
            generate: false,
        }),
        Object.freeze({
            onion: 'gunzuct55pmmmr6l2caxws3nvmaft4stngb5qiwlru3u5sdmv3olblyd',
            seed_hex: '37e7605f36cb3d0f5cea86f1c086cf68b29f461b237c5f3c8b5642f57e9f0932',
            pub_hex: '351b9a0a7debd8c647cbd0817b4b6dab0059f2536983d822cb8d374ec86caedc',
            generate: false,
        }),
        Object.freeze({
            onion: 'gunrbhuxaswhp4ky6puq53i3rlzyrebezhknsnf7s3xcpyojoenubbyd',
            seed_hex: '633c3ccd84687a7099cdd4584a70a3701f8f687354788cfe5012db9f71e24743',
            pub_hex: '351b109e9704ac77f158f3e90eed1b8af3889024c9d4d934bf96ee27e1c9711b',
            generate: false,
        }),
        Object.freeze({
            onion: 'gunz53jxivvg5lqgqd4osifkg32vr7n7fwfdo6jqx4u5jtsvfnqh3dqd',
            seed_hex: 'fc226a8fd88b5862dc1f12e2694c5814710379fc4101e3e9a05590e3c649c77c',
            pub_hex: '351b9eed37456a6eae0680f8e920aa36f558fdbf2d8a377930bf29d4ce552b60',
            generate: false,
        }),
    ]),
});
