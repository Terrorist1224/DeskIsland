import assert from 'node:assert/strict';
import test from 'node:test';
import { findMagnetPosition, moveTileGroup, snapPointToGrid } from '../src/shared/grid.cjs';

test('snapPointToGrid rounds positions to the nearest 16 DIP cell', () => {
  assert.deepEqual(snapPointToGrid({ x: 47, y: 80 }), { x: 48, y: 80 });
});

test('snapPointToGrid rejects invalid cell sizes', () => {
  assert.throws(() => snapPointToGrid({ x: 0, y: 0 }, 0), RangeError);
});

test('findMagnetPosition aligns the closest overlapping tile edge', () => {
  const moving = { id: 'moving', x: 100, y: 40, width: 80, height: 80 };
  const anchor = { id: 'anchor', x: 190, y: 50, width: 100, height: 60 };
  assert.deepEqual(findMagnetPosition(moving, [anchor]), { x: 110, y: 40 });
});

test('findMagnetPosition ignores distant or non-overlapping tiles', () => {
  const moving = { id: 'moving', x: 0, y: 0, width: 40, height: 40 };
  const distant = { id: 'distant', x: 100, y: 0, width: 40, height: 40 };
  const above = { id: 'above', x: 2, y: -60, width: 40, height: 40 };
  assert.equal(findMagnetPosition(moving, [distant, above]), null);
});

test('moveTileGroup moves only selected tiles by a grid-aligned delta', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0, width: 32, height: 32 },
    { id: 'b', x: 32, y: 0, width: 32, height: 32 },
    { id: 'c', x: 96, y: 0, width: 32, height: 32 },
  ];
  assert.deepEqual(moveTileGroup(tiles, new Set(['a', 'b']), { x: 50, y: 0 }), [
    { ...tiles[0], x: 48 },
    { ...tiles[1], x: 80 },
    tiles[2],
  ]);
});
