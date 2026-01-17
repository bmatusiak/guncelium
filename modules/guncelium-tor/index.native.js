'use strict';

// React Native entrypoint.
// This file is selected by Metro for native platforms and can depend on RN-only deps.

function createTorOrThrow() {
    // eslint-disable-next-line global-require
    const impl = require('./react-native');
    if (!impl || typeof impl !== 'object') throw new Error('react-native tor impl did not export an object');
    if (typeof impl.start !== 'function') throw new Error('react-native tor impl start must be a function');
    if (typeof impl.stop !== 'function') throw new Error('react-native tor impl stop must be a function');
    if (typeof impl.status !== 'function') throw new Error('react-native tor impl status must be a function');
    return impl;
}

module.exports = createTorOrThrow;
