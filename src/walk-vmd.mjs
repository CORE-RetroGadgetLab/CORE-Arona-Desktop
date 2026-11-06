// FRAME's first self-contained procedural locomotion study.
// The in-place stance is phase-locked to Electron's horizontal window travel:
// planted IK feet move backwards at a constant speed while the body travels
// forwards. No 3rd-party VMD, avatar, C++ binary, or physics asset is bundled.
import { encodeGeneratedVmd } from './idle-vmd.mjs';

export const WALK_FRAMES = 36; // 1.2 seconds, two footsteps at 30 fps
export const WALK_STANCE = 0.62;
export const WALK_LEG_FORWARD_DEGREES = 12;
export const WALK_LEG_BACKWARD_DEGREES = 22;
export const WALK_SECONDS = WALK_FRAMES / 30;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const id = [0, 0, 0, 1];
const QX = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const QY = a => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const QZ = a => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
function quaternionMultiply(a,b) {
  return [
    a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
  ];
}
const smooth = t => t * t * (3 - 2*t);
const fractional = x => x - Math.floor(x);

export function walkArmPitchAt(swing) {
  const pitch = swing > 0
    ? 8 + 9 * (1 - (1 - swing) ** (28 / 9))
    : 8 + 28 * swing + 3 * swing ** 2;
  const magnitude = Math.abs(pitch);
  const speed = 0.8;
  // Map the old angle to the new angle with slope 0.8 wherever the output
  // is 10..17 degrees. This slows both approach and return, at both ends.
  // Keep the extrema and cycle timing; smoothly make up time in the middle.
  const boundary = (10 - 17 * (1 - speed)) / speed;
  const average = 10 / boundary;
  const cubic = (speed - average) / 2;
  const eased = magnitude >= boundary
    ? 17 - speed * (17 - magnitude)
    : magnitude * (average - cubic + cubic * (magnitude / boundary) ** 2);
  return Math.sign(pitch) * eased * DEG;
}

export function walkGaitFromAngles({ boneNames = [], boneRestPositions = {}, modelHeight = 10,
  forwardDegrees = WALK_LEG_FORWARD_DEGREES, backwardDegrees = WALK_LEG_BACKWARD_DEGREES } = {}) {
  if (![forwardDegrees, backwardDegrees].every(a => Number.isFinite(a) && a >= 0 && a <= 40) ||
      forwardDegrees + backwardDegrees === 0) throw new RangeError('脚の角度は0〜40度で、前後の合計を0より大きくしてください');
  const bones = resolveWalkBones(boneNames);
  const height = Math.max(0.3, Math.min(1000, modelHeight));
  const spans = [['左足', 'LeftLeg', 'LeftUpLeg'], ['右足', 'RightLeg', 'RightUpLeg']].map((names, index) => {
    const hip = names.map(name => boneRestPositions[name]).find(Boolean);
    const ankle = boneRestPositions[index === 0 ? bones.leftIK : bones.rightIK];
    const span = hip?.y - ankle?.y;
    return Number.isFinite(span) && span > 0 ? span : null;
  });
  // One shared span/speed during double support. The shorter leg determines
  // reach on asymmetric rigs. Height is only a fallback if rest data is absent.
  const measured = spans.filter(value => value !== null);
  const legHeight = measured.length ? Math.min(...measured) : height * 0.23;
  const forwardReach = legHeight * Math.tan(forwardDegrees * DEG);
  const backwardReach = legHeight * Math.tan(backwardDegrees * DEG);
  return { forwardDegrees, backwardDegrees, legHeight, forwardReach, backwardReach,
    stride: forwardReach + backwardReach, lift: 0.5 * Math.min(height * 0.025, legHeight * 0.12),
    legHeightSource: measured.length ? 'bone-rest' : 'height-fallback' };
}

export function walkFootAt(phase, gait, direction = 1) {
  const { stride, lift, forwardReach, backwardReach, legHeight, forwardDegrees, backwardDegrees } = gait;
  const p = fractional(phase);
  if (p < WALK_STANCE) {
    return { x: direction * (forwardReach - stride * p / WALK_STANCE), y: 0, planted: true };
  }
  const swing = (p - WALK_STANCE) / (1 - WALK_STANCE);
  const y = lift * Math.sin(Math.PI * swing);
  const drop = legHeight - y;
  // Bound the hip-to-support target angle while the knee/foot lifts as well.
  const x = Math.max(-drop * Math.tan(backwardDegrees * DEG),
    Math.min(drop * Math.tan(forwardDegrees * DEG), -backwardReach + stride * smooth(swing) ** 1.35));
  return {
    // A slightly later recovery lets the trailing leg finish extending.
    x: direction * x,
    y,
    planted: false
  };
}

export function walkTravelSpeed(stride, pixelsPerUnit) {
  return stride * pixelsPerUnit / (WALK_SECONDS * WALK_STANCE);
}

export function walkFootRollAt(phase, toeDistance, ankleHeight, gait = walkGaitFromAngles()) {
  const { x } = walkFootAt(phase, gait);
  // Follow the leg position on both strokes: heel up behind, sole level
  // directly underneath, then toes up ahead. Zero slope at the middle and
  // ends keeps the pitch smooth through passing, contact and release.
  const degrees = x < 0
    ? -25 * smooth(Math.min(1, -x / gait.backwardReach))
    : 15 * smooth(gait.forwardReach > 0 ? Math.min(1, x / gait.forwardReach) : 0);
  const pitch = degrees * DEG;
  // Standard PMX toe IK gives the forefoot lever. Approximate the shorter
  // heel lever conservatively; compensate rotation about the sole contact,
  // not the ankle, so the original constant-speed support path is preserved.
  const pivotZ = pitch < 0 ? -toeDistance : toeDistance * 0.35;
  return {
    pitch,
    x: -ankleHeight * Math.sin(pitch) - pivotZ * (1 - Math.cos(pitch)),
    y: ankleHeight * (Math.cos(pitch) - 1) + pivotZ * Math.sin(pitch)
  };
}

const candidates = Object.freeze({
  leftIK: ['左足ＩＫ', '左足IK', 'LeftLegIK', 'LeftFootIK'],
  rightIK: ['右足ＩＫ', '右足IK', 'RightLegIK', 'RightFootIK'],
  leftArm: ['左腕', 'LeftArm'],
  rightArm: ['右腕', 'RightArm'],
  leftElbow: ['左ひじ', 'LeftElbow'],
  rightElbow: ['右ひじ', 'RightElbow'],
  hip: ['下半身', 'LowerBody'],
  upper: ['上半身', 'UpperBody'],
  neck: ['首', 'Neck'],
  groove: ['グルーブ', 'Groove']
});
export function resolveWalkBones(boneNames) {
  const names = new Set(boneNames);
  return Object.fromEntries(Object.entries(candidates).map(([role, choices]) =>
    [role, choices.find(name => names.has(name)) ?? null]));
}

export function walkBoneRestPositions(runtimeBones) {
  return Object.fromEntries(runtimeBones.map(bone => [bone.name,
    bone.linkedBone.getAbsoluteInverseBindMatrix().clone().invert().getTranslation()]));
}

export function buildWalkingVmd({ boneNames = [], boneRestPositions = {}, modelHeight = 10, direction = 1,
  forwardDegrees = WALK_LEG_FORWARD_DEGREES, backwardDegrees = WALK_LEG_BACKWARD_DEGREES } = {}) {
  const bones = resolveWalkBones(boneNames);
  if (!bones.leftIK || !bones.rightIK) {
    throw new Error('歩行には左右の足IKボーンが必要です（PMXの足IKを確認してください）');
  }
  const sign = direction === -1 ? -1 : 1;
  const height = Math.max(0.3, Math.min(1000, modelHeight));
  const gait = walkGaitFromAngles({ boneNames, boneRestPositions, modelHeight: height, forwardDegrees, backwardDegrees });
  const { stride } = gait;
  // Foot IK parents the toe IK on standard PMX rigs. Orient its local
  // forward (-Z) along travel as well as the pelvis, without moving targets.
  const footHeading = QY(-sign * 90 * DEG);
  const restLeft = boneRestPositions[bones.leftIK];
  const restRight = boneRestPositions[bones.rightIK];
  function footOffset(rest) {
    if (!restLeft || !restRight) return [0, 0];
    const dx = rest.x - (restLeft.x + restRight.x) / 2;
    const dz = rest.z - (restLeft.z + restRight.z) / 2;
    // Rotate the rest stance width about its midpoint, just like the pelvis.
    // Otherwise the original left/right X separation becomes a fore/aft
    // stagger when walking sideways, giving one leg more trailing reach.
    return [-sign * dz - dx, sign * dx - dz];
  }
  const leftOffset = footOffset(restLeft);
  const rightOffset = footOffset(restRight);
  function geometry(side, ankle) {
    const toe = [side + 'つま先ＩＫ', side + 'つま先IK'].map(name => boneRestPositions[name]).find(Boolean);
    return {
      toeDistance: ankle && toe ? Math.abs(toe.z - ankle.z) : height * 0.022,
      ankleHeight: ankle && toe ? Math.abs(ankle.y - toe.y) : height * 0.023
    };
  }
  const footGeometry = { left: geometry('左', restLeft), right: geometry('右', restRight) };
  const frames = [];
  const availableBones = new Set(boneNames);
  const handPose = [];
  for (const [side, mirror] of [['左', 1], ['右', -1]]) {
    for (const finger of ['親指', '人指', '中指', '薬指', '小指']) {
      const thumb = finger === '親指';
      const joints = thumb ? [0, 1, 2] : [1, 2, 3];
      const angles = thumb ? [8, 15, 18] : [20, 30, 20];
      for (let i = 0; i < joints.length; i++) {
        const digit = String(joints[i]);
        const name = [side + finger + String.fromCharCode(0xff10 + joints[i]), side + finger + digit]
          .find(candidate => availableBones.has(candidate));
        if (name) handPose.push({ name, rotation: (thumb && i === 0 ? QY : QZ)(-mirror * angles[i] * DEG) });
      }
    }
  }
  function key(role, frame, rotation = id, position = [0,0,0]) {
    if (bones[role]) frames.push({ name: bones[role], frame, rotation, position });
  }

  // Keys at frame 0 and 36 match; the native window is advanced at the exact
  // stance speed so the planted foot remains approximately fixed in space.
  for (let frame = 0; frame <= WALK_FRAMES; frame += 2) {
    // A constant, gentle curl rather than a clenched fist or rhythmic grip.
    for (const pose of handPose) frames.push({ ...pose, frame, position: [0, 0, 0] });
    const phase = frame / WALK_FRAMES;
    const left = walkFootAt(phase, gait, sign);
    const right = walkFootAt(phase + 0.5, gait, sign);
    for (const [role, foot, offset, geometry, footPhase] of [
      ['leftIK', left, leftOffset, footGeometry.left, phase],
      ['rightIK', right, rightOffset, footGeometry.right, phase + 0.5]
    ]) {
      const roll = walkFootRollAt(footPhase, geometry.toeDistance, geometry.ankleHeight, gait);
      key(role, frame, quaternionMultiply(footHeading, QX(roll.pitch)),
        [foot.x + offset[0] + sign * roll.x, foot.y + roll.y, offset[1]]);
    }

    const cycle = Math.sin(TAU * phase);
    // Lowest during load acceptance (middle of double support), highest
    // at midstance. Keep the pelvis slightly below the straight-leg pose
    // so IK can flex the knees instead of reaching above its rest height.
    const supportPhase = phase - (WALK_STANCE - 0.5) / 2;
    const doubleStep = Math.cos(2 * TAU * supportPhase);
    // Let IK soften the knee bend near either end of a step by easing a
    // little of the crouch, rather than rotating a planted shin off target.
    // Keep at least 70% of the existing dip: no forced straight-knee pose.
    const legEndWeight = Math.max(...[left, right].map(foot => {
      const reach = foot.x * sign;
      const limit = reach < 0 ? gait.backwardReach : gait.forwardReach;
      return smooth(Math.max(0, Math.min(1, (Math.abs(reach) / Math.max(limit, 1e-8) - 0.6) / 0.4)));
    }));
    // Stance runs from 0 to WALK_STANCE: the foot passes beneath the
    // body at its midpoint. Arms reverse at contact/toe-off, not midstance.
    const armSwing = Math.sin(TAU * (phase - WALK_STANCE / 2));
    // MMD rigs commonly make 下半身 and 上半身 separate children of センター.
    // Previously the chest turned +12 degrees, opposite the travel direction,
    // leaving FRAME's face pointed toward the viewer while its legs walked sideways.
    // Face the chest almost along the path; let the neck open just a little
    // toward the camera so the character stays readable from a desktop view.
    // The leading leg brings its side of the pelvis forwards. Use the actual
    // foot separation so the delayed swing recovery stays in phase as well.
    const hipTwist = 8 * Math.max(-1, Math.min(1,
      (left.x - right.x) * sign * (2 * WALK_STANCE) / stride));
    key('hip', frame, quaternionMultiply(QY((-sign * 90 + hipTwist) * DEG), QZ(1.8 * DEG * cycle)));
    // Face along travel, with a +/-10 degree twist following the leading arm.
    const torsoTwist = 10 * armSwing;
    key('upper', frame, quaternionMultiply(QY((-sign * 90 + torsoTwist) * DEG), QZ(-2.5 * DEG * cycle)));
    // Keep the face 20 degrees toward the camera, countering the torso twist
    // and preserving the existing small head sway.
    // TODO: When a model without an upper-body bone is available, recheck whether
    // the neck counter-rotation acts alone. Do not change behavior until verified.
    key('neck', frame, QY((sign * 20 - 1.5 * cycle - torsoTwist) * DEG));
    // Groove moves the torso/leg roots, not the independent planted IK
    // targets. Model-local +Z is the left support side after the hip yaw;
    // mirror it with travel direction. Do not add fore/aft (X) drift.
    key('groove', frame, id, [
      0,
      -height * (0.003 + 0.003 * doubleStep) * (1 - 0.3 * legEndWeight),
      sign * height * 0.003 * Math.sin(TAU * supportPhase)
    ]);

    // Arms swing opposite the feet. Keep the safe lowered-arm bias from the
    // existing idle motion so hands are less likely to cut through clothing.
    // Torso yaw already handles travel direction; local arm swing must not
    // reverse again when walking left. Standard MMD elbows bend about Y.
    // Retain +/-17-degree reach and soften the outer zone in both directions.
    // Left/right remain half a cycle apart, opposite their legs; the shoulder
    // curves join smoothly and keep the original cycle and reversal times.
    key('leftArm', frame, quaternionMultiply(QX(walkArmPitchAt(armSwing)), QZ(-50 * DEG)));
    key('rightArm', frame, quaternionMultiply(QX(walkArmPitchAt(-armSwing)), QZ(50 * DEG)));
    // Rest forearms point along +X on the left and -X on the right: mirrored
    // Y rotations bend both hands forwards (-Z), rather than behind the hips.
    key('leftElbow', frame, QY((18 + 7 * armSwing) * DEG));
    key('rightElbow', frame, QY(-(18 - 7 * armSwing) * DEG));
  }
  return { buffer: encodeGeneratedVmd(frames, [], 'FRAME Walk'), stride, frames: WALK_FRAMES, rig: bones,
    footOffsets: { left: leftOffset, right: rightOffset }, footGeometry, gait };
}
