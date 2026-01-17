import createGunOrThrow from 'guncelium-gun';

setup.consumes = ['app'];
setup.provides = ['gun'];

export default function setup(imports, register) {
    if (!imports || typeof imports !== 'object') throw new Error('imports must be an object');
    if (!imports.app || typeof imports.app !== 'object') throw new Error('imports.app is required');
    if (typeof register !== 'function') throw new Error('register must be a function');

    const gun = createGunOrThrow();
    if (!gun || typeof gun !== 'object') throw new Error('guncelium-gun did not return an object');
    if (typeof gun.start !== 'function') throw new Error('gun.start must be a function');
    if (typeof gun.stop !== 'function') throw new Error('gun.stop must be a function');
    if (typeof gun.status !== 'function') throw new Error('gun.status must be a function');

    register(null, { gun });
}