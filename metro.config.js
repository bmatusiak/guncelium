// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
    ...(config.resolver.extraNodeModules || {}),
    net: path.resolve(__dirname, 'src/shims/net.js'),
};

module.exports = config;
