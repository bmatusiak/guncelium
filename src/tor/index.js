import createTorOrThrow from 'guncelium-tor';

setup.consumes = ['app'];
setup.provides = ['tor'];

export default function setup(imports, register) {
    if (!imports || typeof imports !== 'object') throw new Error('imports must be an object');
    if (!imports.app || typeof imports.app !== 'object') throw new Error('imports.app is required');
    if (typeof register !== 'function') throw new Error('register must be a function');

    const tor = createTorOrThrow();
    if (!tor || typeof tor !== 'object') throw new Error('guncelium-tor did not return an object');
    if (typeof tor.start !== 'function') throw new Error('tor.start must be a function');
    if (typeof tor.stop !== 'function') throw new Error('tor.stop must be a function');
    if (typeof tor.status !== 'function') throw new Error('tor.status must be a function');

    register(null, { tor });
}