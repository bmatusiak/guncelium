async function waitForExit(child, timeoutMs = 2000) {
    if (!child) return true;
    if (child.killed) return true;
    return await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => {
            if (done) return;
            done = true;
            resolve(false);
        }, timeoutMs);
        child.once('exit', () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(true);
        });
    });
}

async function stopProcessGracefully({ child, timeoutMs = 2500 }) {
    if (!child) return { exited: true };
    const pid = child.pid;

    const killProcess = (targetPid, sig) => {
        try {
            process.kill(targetPid, sig);
        } catch (e) {
            if (e && e.code === 'ESRCH') return;
            throw e;
        }
    };

    if (typeof child.kill === 'function') {
        try { child.kill('SIGTERM'); } catch (e) { if (!(e && e.code === 'ESRCH')) throw e; }
    }
    killProcess(pid, 'SIGTERM');

    let exited = await waitForExit(child, timeoutMs);

    if (!exited) {
        if (typeof child.kill === 'function') {
            try { child.kill('SIGKILL'); } catch (e) { if (!(e && e.code === 'ESRCH')) throw e; }
        }
        killProcess(pid, 'SIGKILL');
        exited = await waitForExit(child, 1000);
    }

    return { exited, pid };
}

module.exports = { waitForExit, stopProcessGracefully };
