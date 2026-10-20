import { Registry } from '../engine/registry.js';
import platformer from './platformer.js';
import topdown from './topdown.js';
import collect from './collect.js';
import hazard from './hazard.js';
import health from './health.js';
import patrol from './patrol.js';
import goal from './goal.js';
import timer from './timer.js';
import shooter from './shooter.js';

export const MODULES = [platformer, topdown, collect, hazard, health, patrol, goal, timer, shooter];
export const defaultRegistry = () => new Registry(MODULES);
