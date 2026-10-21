// @ts-check
// Type guards for data from outside the program: model replies (writer.parseReply), stored versions, API
// request bodies, files. Such data is typed `unknown`; code narrows it with these before touching it, and a
// game document only becomes a `Doc` through preflight (kernel/document.js), whose checks come from the cards.

/** @param {unknown} v @returns {v is Record<string, unknown>} a plain object (not null, not an array) */
export const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {v is unknown[]} */
export const isList = v => Array.isArray(v);
/** @param {unknown} v @returns {v is string} */
export const isStr = v => typeof v === 'string';
/** @param {unknown} v @returns {v is number} a finite number */
export const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** The value when it is a plain object, else `{}`. @param {unknown} v @returns {Record<string, unknown>} */
export const obj = v => (isObj(v) ? v : {});
/** The value when it is a list, else `[]`. @param {unknown} v @returns {unknown[]} */
export const list = v => (Array.isArray(v) ? v : []);
/** The plain-object entries of a list (others dropped). @param {unknown} v @returns {Record<string, unknown>[]} */
export const objects = v => list(v).filter(isObj);
/** The string entries of a list (others dropped). @param {unknown} v @returns {string[]} */
export const strings = v => list(v).filter(isStr);
/** The value when it is a string, else `fallback`. @param {unknown} v @param {string} [fallback] @returns {string} */
export const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
/** The value when it is a finite number, else `fallback`. @param {unknown} v @param {number} [fallback] @returns {number} */
export const num = (v, fallback = 0) => (isNum(v) ? v : fallback);
/** Property `k` of `v` when `v` is an object, else undefined. @param {unknown} v @param {string} k @returns {unknown} */
export const prop = (v, k) => (isObj(v) ? v[k] : undefined);
/** An error's message, whatever was thrown. @param {unknown} e @returns {string} */
export const messageOf = e => (e instanceof Error ? e.message : isObj(e) && typeof e.message === 'string' ? e.message : String(e));
