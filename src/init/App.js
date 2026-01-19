import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import app from '../runtime/rectifyApp';
import { GunPanel, MonikerPanel, TorPanel } from './panels';

function isElectronRenderer() {
  const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
  const hasDom = (typeof window === 'object' && typeof window.document !== 'undefined');
  const hasBridge = !!(root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');
  return hasDom && hasBridge;
}

export default function App() {
  const [fatal, setFatal] = useState(null);
  const [services, setServices] = useState(() => (app && app.services ? app.services : {}));
  const [gunStatus, setGunStatus] = useState(null);
  const [gunTcpStatus, setGunTcpStatus] = useState(null);

  useEffect(() => {
    let mounted = true;

    const onError = (e) => {
      if (!mounted) return;
      setFatal(e && e.message ? e.message : String(e));
    };
    const onService = () => {
      if (!mounted) return;
      setServices(app.services || {});
    };
    const onReady = () => {
      if (!mounted) return;
      setServices(app.services || {});
    };

    app.on('error', onError);
    app.on('service', onService);
    app.on('ready', onReady);

    // Initialize immediately in case services already exist.
    setServices(app.services || {});

    return () => {
      mounted = false;
      app.removeListener('error', onError);
      app.removeListener('service', onService);
      app.removeListener('ready', onReady);
    };
  }, []);

  const gun = services ? services.gun : null;
  const gunClient = services ? services.gunClient : null;
  const moniker = services ? services.moniker : null;
  const tor = services ? services.tor : null;

  const envLabel = useMemo(() => {
    if (isElectronRenderer()) return 'electron-renderer';
    if (typeof navigator === 'object' && navigator && navigator.product === 'ReactNative') return 'react-native';
    return 'web/unknown';
  }, []);

  if (fatal) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Fatal</Text>
        <Text style={{ color: '#a00' }}>{fatal}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 6 }}>guncelium</Text>
      <Text style={{ color: '#555', marginBottom: 12 }}>env: {envLabel}</Text>

      <TorPanel tor={tor} gun={gun} />
      <GunPanel gun={gun} gunClient={gunClient} onStatus={setGunStatus} onTcpStatus={setGunTcpStatus} />
      <MonikerPanel moniker={moniker} />

      <StatusBar style="auto" />
    </ScrollView>
  );
}
