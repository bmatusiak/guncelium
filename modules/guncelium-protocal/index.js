'use strict';

const { createSocketAdapterOrThrow } = require('./socketAdapter');
const { socks5HttpGetOrThrow } = require('./socks5Http');

module.exports = {
    createSocketAdapterOrThrow,
    socks5HttpGetOrThrow,
};
