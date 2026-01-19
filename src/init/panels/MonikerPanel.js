import React from 'react';
import { Text, View } from 'react-native';

import duoAlign from '../../__e2e_tests__/duoAlign';
import gunLocalElectron from '../../__e2e_tests__/gunLocalElectron';
import gunLocalReactNative from '../../__e2e_tests__/gunLocalReactNative';

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

                // Gun (local-first)
                gunLocalElectron,
                gunLocalReactNative,
            ]} />
        </View>
    );
}
