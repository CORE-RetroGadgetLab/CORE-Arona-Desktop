'use strict';

// Native movement follows the same 30 fps MMD clock as the foot IK.
// Independent timers accumulate phase jitter between the planted foot
// position and the avatar's on-screen position.
const WALK_FRAMES = 36;
const MMD_FPS = 30;
const MAX_FRAME_STEP = 5;

function walkFrameSeconds(previous, current) {
  if (!Number.isFinite(current) || current < 0 || current > WALK_FRAMES ||
      previous === null || !Number.isFinite(previous) ||
      previous < 0 || previous > WALK_FRAMES) return 0;
  let delta = current - previous;
  // The VMD's closing and opening poses coincide. Continue through the seam.
  if (delta < -WALK_FRAMES / 2) delta += WALK_FRAMES;
  // Avoid walking backwards on a seek or teleporting after a suspended frame.
  if (delta <= 0 || delta > MAX_FRAME_STEP) return 0;
  return delta / MMD_FPS;
}

module.exports = { walkFrameSeconds, WALK_FRAMES, MMD_FPS };
