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
