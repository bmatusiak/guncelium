const net = require('net');

async function isPortFree(host, port) {
    if (!host) throw new Error('host is required');
    if (!Number.isFinite(Number(port)) || Number(port) <= 0) throw new Error(`invalid port: ${port}`);
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        const onError = (err) => {
            // EADDRINUSE is a valid "not free" result; other errors are fatal.
            if (err && err.code === 'EADDRINUSE') resolve(false);
            else reject(err);
        };
        server.once('error', onError);
        server.once('listening', () => {
            server.close((closeErr) => {
                if (closeErr) reject(closeErr);
                else resolve(true);
            });
        });
        server.listen(Number(port), host);
    });
}

module.exports = { isPortFree };
