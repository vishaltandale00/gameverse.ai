// @ts-check
// Card rules (ARCHITECTURE.md §1.4, §3): a primitive's `validate` exists only for rules that cannot be plain data
// (cross-field rules: rooms ≥ keys + 2, a start index inside the stage list), and every problem code it can emit is
// declared on its card:
//
//   card.rules = { <code>: { fields: [<field>, ...], message: '<the allowed values, in words>' } }
//
// `fields` names what the rule constrains, as validate reports it: a param of the instance ('rooms', 'keys',
// 'stages[].goal') or a document path ('content.archetypes[].components.health.resist'); `message` says which values
// are allowed. Forms show the rules on the fields they ask for, repair re-asks those fields, and preflight reports a
// code a validate emits that its card does not declare (rule_undeclared): a rule enforced in code but not declared is
// a defect. Codes the kernel's own schema checks emit (KERNEL_CODES) are declared by the shapes they check (params,
// components, data, references, vocabulary), never by card.rules.
import { isObj } from './guards.js';

/** A declared rule. @typedef {{ fields: string[], message: string }} Rule */

/**
 * The codes the kernel's schema checks emit (params.js checkParam/checkFields, preflight's indexes and references, the
 * logic vocabulary's checks): a validate that re-checks a declared shape through those functions passes them on.
 */
export const KERNEL_CODES = Object.freeze(['param_type', 'param_range', 'param_option', 'param_unknown', 'param_missing', 'param_reserved', 'param_pattern', 'schema_invalid',
  'ref_unknown', 'id_invalid', 'id_duplicate', 'predicate_unknown', 'predicate_invalid', 'effect_unknown', 'event_ref_type', 'validator_crashed']);
const KERNEL = new Set(KERNEL_CODES);
/** A problem code: a lowercase snake_case word. */
export const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/** The rules a card declares, as entries. @param {unknown} card @returns {Array<Rule & { code: string }>} */
export function rulesOf(card) {
  const rules = isObj(card) && isObj(card.rules) ? card.rules : {};
  /** @type {Array<Rule & { code: string }>} */
  const out = [];
  for (const [code, r] of Object.entries(rules)) if (isObj(r)) out.push({ code, fields: Array.isArray(r.fields) ? r.fields.map(String) : [], message: String(r.message ?? '') });
  return out;
}

/** True when a declared field names `field`, a part of it or a whole it is part of. @param {string} declared @param {string} field */
const covers = (declared, field) => declared === field || field.startsWith(`${declared}.`) || field.startsWith(`${declared}[`) || declared.startsWith(`${field}.`) || declared.startsWith(`${field}[`);

/** The rules of a card that constrain a field (a param name or a path within it). @param {unknown} card @param {string} field */
export const rulesOn = (card, field) => rulesOf(card).filter(r => r.fields.some(f => covers(f, field)));

/** True when a validate of this card may emit the code: its card declares it, or a kernel schema check owns it. @param {unknown} card @param {string} code */
export const declaresCode = (card, code) => KERNEL.has(code) || rulesOf(card).some(r => r.code === code);

/**
 * What is wrong with a card's rules declaration: not an object of codes, a code that is not snake_case or is a kernel
 * code, a rule without fields or message. -> [{ code: 'rules_invalid', path, message }]
 * @param {unknown} card @param {string} [id]
 */
export function ruleShapeProblems(card, id = '') {
  if (!isObj(card) || card.rules === undefined) return [];
  const at = (/** @type {string} */ p) => `${id ? `${id}.` : ''}card.rules${p}`;
  if (!isObj(card.rules)) return [{ code: 'rules_invalid', path: at(''), message: 'card.rules is an object of { <code>: { fields, message } }' }];
  const out = [];
  for (const [code, r] of Object.entries(card.rules)) {
    if (!CODE_PATTERN.test(code)) out.push({ code: 'rules_invalid', path: at(`.${code}`), message: `'${code}' is not a snake_case problem code` });
    else if (KERNEL.has(code)) out.push({ code: 'rules_invalid', path: at(`.${code}`), message: `'${code}' is a kernel schema code: the shape it checks declares it` });
    if (!isObj(r) || !Array.isArray(r.fields) || !r.fields.length || !r.fields.every(f => typeof f === 'string' && f.length > 0)) out.push({ code: 'rules_invalid', path: at(`.${code}.fields`), message: 'fields lists the params or document paths the rule constrains' });
    if (!isObj(r) || typeof r.message !== 'string' || !r.message.trim()) out.push({ code: 'rules_invalid', path: at(`.${code}.message`), message: 'message says which values the rule allows' });
  }
  return out;
}
