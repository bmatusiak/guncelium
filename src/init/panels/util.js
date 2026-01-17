export function toErrorMessage(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof err.message === 'string') return err.message;
    try {
        return JSON.stringify(err);
    } catch (e) {
        return String(err);
    }
}

export function safeJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch (e) {
        return String(value);
    }
}

export function jsonForLogOrThrow(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) throw new Error('jsonForLogOrThrow: value is undefined');
    if (typeof value === 'bigint') throw new Error('jsonForLogOrThrow: cannot JSON stringify bigint');
    const s = JSON.stringify(value);
    if (typeof s !== 'string') throw new Error('jsonForLogOrThrow: JSON.stringify returned non-string');
    return s;
}

export function requireObject(value, name) {
    if (!value || typeof value !== 'object') throw new Error(`${name} must be an object`);
}

export function requireFunction(value, name) {
    if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}
