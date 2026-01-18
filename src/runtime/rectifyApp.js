import rectify from '@bmatusiak/rectify';

import gun from '../gun';
import gunClient from '../gunClient';
import moniker from '../moniker';
import tor from '../tor';

function isElectronRenderer() {
    const root = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    const hasDom = (typeof window === 'object' && typeof window.document !== 'undefined');
    const hasPreloadBridge = !!(root && typeof root === 'object' && root.ElectronNative && typeof root.ElectronNative === 'object');
    return hasDom && hasPreloadBridge;
}

function isReactNative() {
    if (typeof navigator === 'object' && navigator && navigator.product === 'ReactNative') return true;
    const root = (typeof globalThis !== 'undefined') ? globalThis : null;
    return !!(root && typeof root === 'object' && root.__fbBatchedBridge);
}

const config = (isElectronRenderer() || isReactNative())
    ? [gun, gunClient, tor, moniker]
    : [gun, gunClient, moniker];

const app = rectify.build(config);

export default app;
