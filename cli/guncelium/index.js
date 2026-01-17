#!/usr/bin/env node
'use strict';

// Intentionally use the Rectify implementation bundled with test-moniker,
// since its CLI is the reference implementation we’re following here.
const rectify = require('test-moniker/moniker-cli/rectify');

const argsPlugin = require('./plugins/args');
const servicePlugin = require('./plugins/service');

async function main() {
    const config = [argsPlugin, servicePlugin];
    const app = rectify.build(config);

    const started = await app.start();
    if (!started || typeof started !== 'object') throw new Error('rectify app failed to start');
}

main().catch((e) => {
    // fail-fast
    // eslint-disable-next-line no-console
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
});
