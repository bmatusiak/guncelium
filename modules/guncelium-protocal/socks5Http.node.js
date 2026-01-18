'use strict';

const { socks5HttpGetWithCreateConnectionOrThrow } = require('./socks5HttpCore');

function socks5HttpGetNodeOrThrow(opts) {
    // Node/Electron only: uses node:net. Do NOT import this from React Native.
    // eslint-disable-next-line global-require
    const net = require('node:net');
    if (!net || typeof net.createConnection !== 'function') throw new Error('node:net.createConnection is required');

    return socks5HttpGetWithCreateConnectionOrThrow({
        ...opts,
        createConnection: ({ host, port }) => net.createConnection({ host, port }),
    });
}

module.exports = {
    socks5HttpGetNodeOrThrow,
};
