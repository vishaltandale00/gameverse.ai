// Primitives registered by the combat workstream (KERNEL_API.md §7). Only that workstream edits this file.
import resource from './resource.js';
import health from './combat-health.js';
import status from './combat-status.js';
import melee from './combat-melee.js';
import projectile from './combat-projectile.js';
import target from './combat-target.js';
import boss from './combat-boss.js';
import stealth from './combat-stealth.js';
import cover from './combat-cover.js';
import aim from './combat-aim.js';
import versus from './combat-versus.js';
import knockback from './combat-knockback.js';
import element from './element.js';
import vision from './vision-mode.js';
import death from './death.js';
import score from './score.js';
import powerup from './powerup.js';
import abilityActive from './ability-active.js';

export default [resource, health, status, melee, projectile, target, boss, stealth, cover, aim, versus, knockback, element, vision, death, score, powerup, abilityActive];
