import React from 'react';
import { Text, View } from 'react-native';

import duoAlign from '../../__e2e_tests__/duoAlign';
import torGunHosting from '../../__e2e_tests__/torGunHosting';
import torGunExchangeHost from '../../__e2e_tests__/torGunExchangeHost';
import torGunExchangeClient from '../../__e2e_tests__/torGunExchangeClient';
import rnTorSmoke from '../../__e2e_tests__/rnTorSmoke';
import rnTorHosting from '../../__e2e_tests__/rnTorHosting';

export default function MonikerPanel({ moniker }) {
    if (!moniker) {
        return (
            <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Test Moniker</Text>
                <Text style={{ color: '#a00' }}>moniker service not available</Text>
            </View>
        );
    }
    if (!moniker.MonikerView) throw new Error('moniker.MonikerView missing');

    const MonikerView = moniker.MonikerView;

    return (
        <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Test Moniker</Text>
            <MonikerView tests={[
                // Duo section: both devices online
                duoAlign,

                // Tor tests disabled while Duo alignment is stabilized.
                // torGunHosting,
                // rnTorSmoke,
                // rnTorHosting,
                // torGunExchangeHost,
                // torGunExchangeClient,
            ]} />
        </View>
    );
}
