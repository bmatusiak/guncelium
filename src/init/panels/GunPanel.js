import React, { useCallback, useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';

import { jsonForLogOrThrow, requireFunction, safeJson, toErrorMessage } from './util';

function normalizeGunStatus(st) {
    if (!st || typeof st !== 'object') return { ok: false, running: false, port: null, storeDir: null };
    return {
        ok: st.ok === true,
        running: st.running === true,
        port: (typeof st.port === 'number' || typeof st.port === 'string') ? st.port : null,
        storeDir: st.storeDir || null,
        raw: st,
    };
}

function normalizeGunTcpStatus(st) {
    if (!st || typeof st !== 'object') return { ok: false, running: false, port: null, storeDir: null };
    return {
        ok: st.ok === true,
        running: st.running === true,
        port: (typeof st.port === 'number' || typeof st.port === 'string') ? st.port : null,
        storeDir: st.storeDir || null,
        raw: st,
    };
}

export default function GunPanel({ gun, onStatus, onTcpStatus }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null);
    const [tcpStatus, setTcpStatus] = useState(null);

    const canUse = useMemo(() => {
        try {
            if (!gun || typeof gun !== 'object') return { ok: false, reason: 'gun service not available' };
            requireFunction(gun.start, 'gun.start');
            requireFunction(gun.stop, 'gun.stop');
            requireFunction(gun.status, 'gun.status');
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: toErrorMessage(e) };
        }
    }, [gun]);

    const publishStatus = useCallback((st) => {
        const norm = normalizeGunStatus(st);
        setStatus(norm);
        if (typeof onStatus === 'function') {
            onStatus(norm);
        }
    }, [onStatus]);

    const publishTcpStatus = useCallback((st) => {
        const norm = normalizeGunTcpStatus(st);
        setTcpStatus(norm);
        if (typeof onTcpStatus === 'function') {
            onTcpStatus(norm);
        }
    }, [onTcpStatus]);

    const refresh = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'gun unavailable');
            // eslint-disable-next-line no-console
            console.log('[ui][gun] refresh');
            const st = await gun.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] status result ${jsonForLogOrThrow(st)}`);
            publishStatus(st);

            if (gun.tcpStatus && typeof gun.tcpStatus === 'function') {
                const tcpSt = await gun.tcpStatus();
                // eslint-disable-next-line no-console
                console.log(`[ui][gun] tcp status result ${jsonForLogOrThrow(tcpSt)}`);
                publishTcpStatus(tcpSt);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][gun] refresh error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, gun, publishStatus, publishTcpStatus]);

    const start = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'gun unavailable');
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] start ${jsonForLogOrThrow({ port: 0 })}`);
            await gun.start({ port: 0 });
            const st = await gun.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] status after start ${jsonForLogOrThrow(st)}`);
            publishStatus(st);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][gun] start error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, gun, publishStatus]);

    const stop = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'gun unavailable');
            // eslint-disable-next-line no-console
            console.log('[ui][gun] stop');
            await gun.stop();
            const st = await gun.status();
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] status after stop ${jsonForLogOrThrow(st)}`);
            publishStatus(st);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][gun] stop error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, gun, publishStatus]);

    const tcpStart = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'gun unavailable');
            if (!gun.tcpStart || typeof gun.tcpStart !== 'function') throw new Error('gun.tcpStart not available');
            if (!gun.tcpStatus || typeof gun.tcpStatus !== 'function') throw new Error('gun.tcpStatus not available');
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] tcp start ${jsonForLogOrThrow({ port: 0, host: '127.0.0.1' })}`);
            await gun.tcpStart({ port: 0, host: '127.0.0.1' });
            const st = await gun.tcpStatus();
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] tcp status after start ${jsonForLogOrThrow(st)}`);
            publishTcpStatus(st);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][gun] tcp start error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, gun, publishTcpStatus]);

    const tcpStop = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!canUse.ok) throw new Error(canUse.reason || 'gun unavailable');
            if (!gun.tcpStop || typeof gun.tcpStop !== 'function') throw new Error('gun.tcpStop not available');
            if (!gun.tcpStatus || typeof gun.tcpStatus !== 'function') throw new Error('gun.tcpStatus not available');
            // eslint-disable-next-line no-console
            console.log('[ui][gun] tcp stop');
            await gun.tcpStop();
            const st = await gun.tcpStatus();
            // eslint-disable-next-line no-console
            console.log(`[ui][gun] tcp status after stop ${jsonForLogOrThrow(st)}`);
            publishTcpStatus(st);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error(`[ui][gun] tcp stop error ${toErrorMessage(e)}`);
            setError(toErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, [canUse.ok, canUse.reason, gun, publishTcpStatus]);

    return (
        <View style={{ padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Gun</Text>
            {!canUse.ok ? (
                <Text style={{ color: '#a00' }}>Unavailable: {canUse.reason}</Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <Button title={busy ? 'Working…' : 'Refresh'} onPress={refresh} disabled={!canUse.ok || busy} />
                <Button title="Start" onPress={start} disabled={!canUse.ok || busy} />
                <Button title="Stop" onPress={stop} disabled={!canUse.ok || busy} />
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <Button title="TCP Start" onPress={tcpStart} disabled={!canUse.ok || busy || !(gun && typeof gun.tcpStart === 'function')} />
                <Button title="TCP Stop" onPress={tcpStop} disabled={!canUse.ok || busy || !(gun && typeof gun.tcpStop === 'function')} />
            </View>

            {error ? <Text style={{ color: '#a00' }}>Error: {error}</Text> : null}

            <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{safeJson(status)}</Text>
            {tcpStatus ? <Text style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}>{safeJson(tcpStatus)}</Text> : null}
        </View>
    );
}
