// Primitives registered by the generate2d workstream (KERNEL_API.md §7). Only that workstream edits this file.
// 2D and abstract world generators (slot: spaces[].generators[]); each proves what it promises.
import tilemapRooms from './generate-tilemap-rooms.js';
import dungeonRooms from './generate-dungeon-rooms.js';
import graphWorld from './generate-graph-world.js';
import gridBoard from './generate-grid-board.js';
import gridMaze from './generate-grid-maze.js';
import chunks from './generate-chunks.js';
import tilemapOverworld from './generate-tilemap-overworld.js';
import layoutShapes from './generate-layout-shapes.js';

export default [tilemapRooms, dungeonRooms, graphWorld, gridBoard, gridMaze, chunks, tilemapOverworld, layoutShapes];
