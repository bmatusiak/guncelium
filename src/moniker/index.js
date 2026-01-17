import testMoniker from 'test-moniker';

setup.consumes = ['app'];
setup.provides = ['moniker'];

export default function setup(imports, register) {
    if (!imports || typeof imports !== 'object') throw new Error('imports must be an object');
    if (!imports.app || typeof imports.app !== 'object') throw new Error('imports.app is required');
    if (typeof register !== 'function') throw new Error('register must be a function');

    if (!testMoniker || typeof testMoniker !== 'object') throw new Error('test-moniker did not export an object');
    if (!testMoniker.harness || typeof testMoniker.harness !== 'object') throw new Error('test-moniker.harness missing');
    if (!testMoniker.MonikerView) throw new Error('test-moniker.MonikerView missing');

    const moniker = {
        harness: testMoniker.harness,
        MonikerView: testMoniker.MonikerView,
    };

    register(null, { moniker });
}
