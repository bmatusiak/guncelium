# guncelium-tor

Cross-platform Tor service wrapper for **Electron renderer** and **React Native**.

- Entry: `require('guncelium-tor')()` (or `import createTorOrThrow from 'guncelium-tor'`)
- Electron: talks to Electron main over IPC (via the preload bridge)
- React Native: talks to `react-native-nitro-tor` via NitroModules + Expo filesystem

This module is **fail-fast** by design: operations either succeed (return a result object) or **throw**.

## Environment selection

`guncelium-tor` selects an implementation at runtime:

- **Electron renderer**: returns `window.ElectronNative['guncelium-tor']` (preload-loaded)
- **React Native**: loads the RN implementation (`index.native.js` → `react-native/index.js`)
- Other environments: throws `guncelium-tor is not implemented for this environment`

## Canonical API (contract)

`createTorOrThrow(): TorApi`

All functions are async unless noted.

### `tor.info(): Promise<TorInfo>`

Returns current Tor state.

- Electron: reports installation + running process info
- React Native: Tor is “installed” if the native module is present

Typical shape:

```js
{
  ok: true,                // RN always includes ok:true; Electron may omit ok
  installed: boolean,
  running: boolean,
  mode: 'electron' | 'react-native',
  version?: string | null, // Electron
  path?: string | null,    // Electron
  pid?: number | null,     // Electron
  socksPort?: number,      // RN
  dataDir?: string | null  // RN
}
```

### `tor.status(): Promise<TorInfo>`

Alias for `tor.info()`.

### `tor.install(opts: object): Promise<object>`

- Electron: downloads/installs Tor binaries for the app (desktop install)
- React Native: verifies prerequisites and ensures the app-owned Tor data dir exists

Throws on failure.

### `tor.uninstall(): Promise<object>`

- Electron: stops Tor (if running) and removes the installed Tor directory
- React Native: stops Tor (if running) and deletes the app-owned Tor data directory

Throws on failure.

### `tor.start(opts?: StartOpts): Promise<StartResult>`

Start Tor.

`StartOpts`:

- `cleanSlate?: boolean`
  - Electron: wipes hidden service dirs/results + rewrites a minimal `torrc`
  - React Native: stops Tor (if running) and deletes the app-owned data dir
- `socksPort?: number` (React Native only)
  - Can only be changed while Tor is stopped

`StartResult`:

- Electron (typical): `{ ok: true, pid: number, controlPort: 9051 }`
- React Native (typical): `{ ok: true, running: true, installed: true, mode: 'react-native', onion?, onionAddress? }`

### `tor.stop(): Promise<object>`

Stops Tor. Throws on failure.

## Hidden services

### `tor.hiddenServices.save({ keys }): Promise<{ ok: true, path, keys }>`

Persists hidden service key material.

- Electron: writes under the app’s Tor directory
- React Native: writes to `<documentDirectory>/guncelium/tor/hidden-services.json`

### `tor.hiddenServices.list(): Promise<{ ok: true, keys: array }>`

Loads saved hidden service key material. If none exists, returns `{ ok:true, keys: [] }`.

### `tor.hiddenServices.create(opts): Promise<object>`

Configures hidden services for the next `tor.start()`.

`opts`:

- `keys: Array<KeySpec>` (required; must have at least one entry)
- `port: number` (required) — local port to forward to
- `virtualPort?: number` (default `80`) — port exposed on the onion service
- `service?: string` (default `'default'`) — logical name
- `controlPort?: boolean` (Electron only) — request ControlPort enablement

React Native note: `hiddenServices.create()` **does not start Tor**. It stores a pending config that `tor.start()` will use.

## Tor+Gun protocol key pool (bootstrap identities)

The Tor+Gun protocol uses a **key pool** to reduce bootstrap friction.

Intended behavior:

- Maintain a fixed pool of 5 pre-generated “bootstrap” onion identities.
- When hosting, randomly pick:
  - 1 key from the pool, plus
  - 1 freshly generated key (for additional anonymity)
- When dialing peers, attempt connections to the pool identities (excluding “the one we are currently hosting on”).

This alone does **not** prevent double-connecting (both sides dialing each other simultaneously). We’ll handle that at the protocol/session layer.

### Bootstrap key pool (5x `gun*` v3 vanity)

These are stored in [modules/guncelium-tor/gunKeyPool.js](modules/guncelium-tor/gunKeyPool.js) and are intended to be used as *public bootstrap identities*.

Security note: these include `seed_hex` (private key material). Anyone with these can impersonate the corresponding onion identity.

```js
[
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
]
```

### `tor.hiddenServices.status(): Promise<HiddenServiceStatus>`

- Electron: queries status via the Tor ControlPort and returns current results.
- React Native: reports last-known onion result from the most recent `tor.start()`.

RN returns `.onion` without the `.onion` suffix.

## Control port

### `tor.control.check({ host, port }): Promise<object>`

- Electron: connects and performs a minimal ControlPort protocol probe.
- React Native: **not supported** (throws).

## KeySpec

A `KeySpec` entry is an object.

- Use existing key material:

```js
{ onion: '<56-char v3 host>', seed_hex: '<64 hex>', pub_hex: '<64 hex>', generate: false }
```

- Generate a fresh keypair:

```js
{ generate: true, maxAttempts: 250000 }
```

- Generate vanity prefix (bounded attempts):

```js
{ generate: true, vanity: 'gun', maxAttempts: 250000 }
```

## Usage examples

### Electron renderer

```js
import createTorOrThrow from 'guncelium-tor';

const tor = createTorOrThrow();
await tor.install({});
await tor.hiddenServices.create({
  service: 'gun-tcp',
  port: 12345,
  virtualPort: 8888,
  controlPort: true,
  keys: [{ generate: true, maxAttempts: 250000 }],
});
await tor.start({ cleanSlate: true });
const hs = await tor.hiddenServices.status();
```

### React Native

```js
import createTorOrThrow from 'guncelium-tor';

const tor = createTorOrThrow();
await tor.install({});
await tor.hiddenServices.create({
  service: 'gun-tcp',
  port: 12345,
  virtualPort: 8888,
  keys: [{ generate: true, maxAttempts: 250000 }],
});
const started = await tor.start({ cleanSlate: false, socksPort: 8765 });
```

## Platform notes

- React Native must not import Node.js builtins in Metro bundles; the Tor wrapper stays RN-safe.
- Electron main is responsible for installing/running the Tor binary; renderer never spawns processes directly.
