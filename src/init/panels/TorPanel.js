import React, { useCallback, useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';

import { pickGunTorHostingKeysOrThrow } from '../../tor/keyPool';

import { jsonForLogOrThrow, requireFunction, safeJson, toErrorMessage } from './util';

const DEFAULT_GUN_KEY_MAX_ATTEMPTS = 250000;

function normalizeInfo(info) {
    if (!info || typeof info !== 'object') return { installed: false, running: false, raw: info || null };
    return {
        installed: info.installed === true,
        running: info.running === true,
        version: info.version || null,
        path: info.path || null,
        pid: info.pid || null,
        raw: info,
    };
}

export default function TorPanel({ tor, gunTcpPort }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [info, setInfo] = useState(null);
    const [hsStatus, setHsStatus] = useState(null);
    const [lastResult, setLastResult] = useState(null);

    const canUse = useMemo(() => {
        try {
            if (!tor || typeof tor !== 'object') return { ok: false, reason: 'tor service not available' };
            requireFunction(tor.start, 'tor.start');
            requireFunction(tor.stop, 'tor.stop');
            // status() exists on all implementations; info/install may be electron-only.
            requireFunction(tor.status, 'tor.status');
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: toErrorMessage(e) };
        }
    }, [tor]);

    const refreshInfo = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            // eslint-disable-next-line no-console
            console.log('[ui][tor] refresh');
            const r = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] info/status result ${jsonForLogOrThrow(r)}`);
            setInfo(normalizeInfo(r));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] refresh error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, tor]);

    const install = useCallback(async () => {
        setBusy(true);
        setError(null);
        setLastResult(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            if (!tor.install || typeof tor.install !== 'function') throw new Error('tor.install not available in this environment');
            // eslint-disable-next-line no-console
            console.log('[ui][tor] install');
            const r = await tor.install({});
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] install result ${jsonForLogOrThrow(r)}`);
            setLastResult(r);
            const infoR = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] info after install ${jsonForLogOrThrow(infoR)}`);
            setInfo(normalizeInfo(infoR));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] install error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, tor]);

    const uninstall = useCallback(async () => {
        setBusy(true);
        setError(null);
        setLastResult(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            if (!tor.uninstall || typeof tor.uninstall !== 'function') throw new Error('tor.uninstall not available in this environment');
            // eslint-disable-next-line no-console
            console.log('[ui][tor] uninstall');
            const r = await tor.uninstall();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] uninstall result ${jsonForLogOrThrow(r)}`);
            setLastResult(r);
            const infoR = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] info after uninstall ${jsonForLogOrThrow(infoR)}`);
            setInfo(normalizeInfo(infoR));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] uninstall error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, tor]);

    const start = useCallback(async (cleanSlate) => {
        setBusy(true);
        setError(null);
        setLastResult(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] start ${jsonForLogOrThrow({ cleanSlate: cleanSlate === true })}`);
            const r = await tor.start({ cleanSlate: cleanSlate === true });
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] start result ${jsonForLogOrThrow(r)}`);
            setLastResult(r);
            const infoR = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] info after start ${jsonForLogOrThrow(infoR)}`);
            setInfo(normalizeInfo(infoR));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] start error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, tor]);

    const stop = useCallback(async () => {
        setBusy(true);
        setError(null);
        setLastResult(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            // eslint-disable-next-line no-console
            console.log('[ui][tor] stop');
            const r = await tor.stop();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] stop result ${jsonForLogOrThrow(r)}`);
            setLastResult(r);
            const infoR = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] info after stop ${jsonForLogOrThrow(infoR)}`);
            setInfo(normalizeInfo(infoR));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] stop error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, tor]);

    const refreshHiddenServices = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            if (!tor.hiddenServices || typeof tor.hiddenServices !== 'object') throw new Error('tor.hiddenServices not available');
            if (typeof tor.hiddenServices.status !== 'function') throw new Error('tor.hiddenServices.status not available');
            // eslint-disable-next-line no-console
            console.log('[ui][tor] hidden services status');
            const st = await tor.hiddenServices.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] hidden services status result ${jsonForLogOrThrow(st)}`);
            setHsStatus(st);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] hidden services status error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, tor]);

    const restartWithGunTcpHiddenService = useCallback(async () => {
        setBusy(true);
        setError(null);
        setLastResult(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'tor unavailable');
            if (!gunTcpPort) throw new Error('gun tcp must be running to attach a hidden service');
            if (!tor.hiddenServices || typeof tor.hiddenServices !== 'object') throw new Error('tor.hiddenServices not available');
            if (typeof tor.hiddenServices.create !== 'function') throw new Error('tor.hiddenServices.create not available');

            // eslint-disable-next-line no-console
            console.log(`[ui][tor] restart with gun tcp hidden service ${jsonForLogOrThrow({ gunTcpPort: Number(gunTcpPort) })}`);

            // Stop Tor if it is running; if it isn't, fail-fast behavior is handled by tor.stop.
            let infoR = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            if (infoR && infoR.running === true) {
                await tor.stop();
            }

            const created = await tor.hiddenServices.create({
                port: Number(gunTcpPort),
                virtualPort: 8888,
                service: 'gun-tcp',
                controlPort: true,
                keys: pickGunTorHostingKeysOrThrow({ bootstrapCount: 1, includeRandom: true, maxAttempts: DEFAULT_GUN_KEY_MAX_ATTEMPTS }),
            });

            // eslint-disable-next-line no-console
            console.log(`[ui][tor] hidden service create result ${jsonForLogOrThrow(created)}`);

            const started = await tor.start({ cleanSlate: false });
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] tor start after hs result ${jsonForLogOrThrow(started)}`);
            setLastResult({
                ok: true,
                hiddenServicesCreate: created,
                torStart: started,
            });

            infoR = (tor.info && typeof tor.info === 'function') ? await tor.info() : await tor.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][tor] info after hs start ${jsonForLogOrThrow(infoR)}`);
            setInfo(normalizeInfo(infoR));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][tor] restart with gun hs error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, gunTcpPort, tor]);

    return (
        <View style={{ padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Tor</Text>
            {!canUse.ok ? (
                <Text style={{ color: '#a00' }}>Unavailable: {canUse.reason}</Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <Button title={busy ? 'Working…' : 'Refresh'} onPress={refreshInfo} disabled={!canUse.ok || busy} />
                <Button title="Install" onPress={install} disabled={!canUse.ok || busy} />
                <Button title="Uninstall" onPress={uninstall} disabled={!canUse.ok || busy} />
                <Button title="Start (clean)" onPress={() => start(true)} disabled={!canUse.ok || busy} />
                <Button title="Stop" onPress={stop} disabled={!canUse.ok || busy} />
            </View>

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <Button title="HS Status" onPress={refreshHiddenServices} disabled={!canUse.ok || busy} />
                <Button title="Restart w/ Gun TCP HS" onPress={restartWithGunTcpHiddenService} disabled={!canUse.ok || busy || !gunTcpPort} />
            </View>

            {error ? <Text style={{ color: '#a00' }}>Error: {error}</Text> : null}

            <Text style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>{safeJson(info)}</Text>
            {hsStatus ? <Text style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6 }}>{safeJson(hsStatus)}</Text> : null}
            {lastResult ? <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{safeJson(lastResult)}</Text> : null}
        </View>
    );
}
