import testMoniker from 'test-moniker';

setup.consumes = ['app'];
setup.provides = ['moniker'];

export default function setup(imports, register) {
    if (!imports || typeof imports !== 'object') throw new Error('imports must be an object');
    if (!imports.app || typeof imports.app !== 'object') throw new Error('imports.app is required');
    if (typeof register !== 'function') throw new Error('register must be a function');

    if (!testMoniker || typeof testMoniker !== 'object') throw new Error('test-moniker did not export an object');

    const resolved = (testMoniker.harness && testMoniker.MonikerView)
        ? testMoniker
        : ((testMoniker.default && typeof testMoniker.default === 'object') ? testMoniker.default : null);

    if (!resolved || typeof resolved !== 'object') throw new Error('test-moniker export shape not supported');
    if (!resolved.harness || typeof resolved.harness !== 'object') throw new Error('test-moniker.harness missing');
    if (!resolved.MonikerView) throw new Error('test-moniker.MonikerView missing');

    const moniker = {
        harness: resolved.harness,
        MonikerView: resolved.MonikerView,
    };

    return register(null, { moniker });
}
