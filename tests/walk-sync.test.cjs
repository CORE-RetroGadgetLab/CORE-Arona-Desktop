'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { walkFrameSeconds, WALK_FRAMES } = require('../electron/walk-sync.cjs');

test('native walking advances by the exact rendered MMD frame delta', () => {
  assert.equal(walkFrameSeconds(null, 0), 0);
  assert.equal(walkFrameSeconds(3, 3.5), 0.5 / 30);
  assert.equal(walkFrameSeconds(3.5, 3.5), 0);
  assert.equal(walkFrameSeconds(3.5, 4), 0.5 / 30);
  assert.equal(walkFrameSeconds(35.5, WALK_FRAMES), 0.5 / 30);
  assert.ok(Math.abs(walkFrameSeconds(WALK_FRAMES, 0.5) - 0.5 / 30) < 1e-10);
});

test('non-sequential seeks and long suspended frame gaps do not jump the avatar', () => {
  assert.equal(walkFrameSeconds(7, 2), 0);
  assert.equal(walkFrameSeconds(8, 25), 0);
  assert.equal(walkFrameSeconds(10, NaN), 0);
  assert.equal(walkFrameSeconds(10, -1), 0);
  assert.equal(walkFrameSeconds(10, 100), 0);
});

test('screen movement cancels planted IK displacement over a stance frame', async () => {
  const { WALK_SECONDS, WALK_STANCE, WALK_FRAMES: generatedFrames,
    walkFootAt, walkTravelSpeed } = await import('../src/walk-vmd.mjs');
  assert.equal(generatedFrames, WALK_FRAMES);
  const stride = 1.6, pixelsPerUnit = 100;
  const speed = walkTravelSpeed(stride, pixelsPerUnit);
  for (const direction of [-1, 1]) {
    const first = 4, deltaFrames = 0.5;
    const seconds = walkFrameSeconds(first, first + deltaFrames);
    const screenTravel = direction * speed * seconds;
    const firstFoot = walkFootAt(first / WALK_FRAMES, stride, 0, direction);
    const nextFoot = walkFootAt((first + deltaFrames) / WALK_FRAMES, stride, 0, direction);
    const footTravel = (nextFoot.x - firstFoot.x) * pixelsPerUnit;
    assert.ok(Math.abs(screenTravel + footTravel) < 1e-9);
  }
});
