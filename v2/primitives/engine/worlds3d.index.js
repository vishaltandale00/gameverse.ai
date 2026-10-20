// Primitives registered by the worlds3d workstream (KERNEL_API.md §7). Only that workstream edits this file.
import spaceVoxel from './space-voxel.js';
import spaceMesh3d from './space-mesh3d.js';
import terrainNoise from './generate-terrain-noise.js';
import biomes from './generate-biomes.js';
import water from './generate-water.js';
import caves from './generate-caves.js';
import ores from './generate-ores.js';
import roads from './generate-roads.js';
import city from './generate-city.js';
import structures from './generate-structures.js';
import scatter from './generate-scatter.js';

export default [spaceVoxel, spaceMesh3d, terrainNoise, biomes, water, caves, ores, roads, city, structures, scatter];
