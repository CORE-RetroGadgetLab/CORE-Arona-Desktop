import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WALK_FRAMES, WALK_STANCE, WALK_SECONDS, WALK_LEG_FORWARD_DEGREES, WALK_LEG_BACKWARD_DEGREES,
  walkFootAt, walkTravelSpeed, resolveWalkBones, buildWalkingVmd, walkArmPitchAt, walkFootRollAt, walkGaitFromAngles
} from '../src/walk-vmd.mjs';

const bones = [
  '左足ＩＫ', '右足ＩＫ', '左腕', '右腕', '左ひじ', '右ひじ',
  '上半身', '下半身', '首', 'グルーブ'
];

test('arm approach and return slow to 0.8 at both ends without changing extrema', () => {
  const degrees = radians => radians * 180 / Math.PI;
  const previous = swing => swing > 0
    ? 8 + 9 * (1 - (1 - swing) ** (28 / 9))
    : 8 + 28 * swing + 3 * swing ** 2;
  assert.ok(Math.abs(degrees(walkArmPitchAt(1)) - 17) < 1e-9);
  assert.ok(Math.abs(degrees(walkArmPitchAt(-1)) + 17) < 1e-9);
  const delta = 1e-5;
  for (const swing of [-0.95, -0.8, 0.2, 0.6]) {
    assert.ok(Math.abs(degrees(walkArmPitchAt(swing))) >= 10);
    const ratio = (walkArmPitchAt(swing + delta) - walkArmPitchAt(swing - delta)) * 180 / Math.PI /
      (previous(swing + delta) - previous(swing - delta));
    assert.ok(Math.abs(ratio - 0.8) < 1e-5, 'angular speed scales equally in either direction');
  }
  for (let i = 0; i <= 200; i++) {
    const swing = -1 + i / 100;
    assert.ok(Math.abs(degrees(walkArmPitchAt(swing))) <= 17.000001);
    if (i) assert.ok(walkArmPitchAt(swing) >= walkArmPitchAt(swing - 0.01), 'no reversal within a stroke');
  }
});

function extractVmd(buffer) {
  const view = new DataView(buffer);
  let cursor = 50;
  const count = view.getUint32(cursor, true); cursor += 4;
  const decoder = new TextDecoder('shift_jis');
  const samples = [];
  for (let i=0;i<count;i++) {
    const name = decoder.decode(new Uint8Array(buffer, cursor, 15)).replace(/\0+$/, '');
    const frame = view.getUint32(cursor+15, true);
    const pos = [0,1,2].map(k=>view.getFloat32(cursor+19+4*k, true));
    const quat = [0,1,2,3].map(k=>view.getFloat32(cursor+31+4*k, true));
    samples.push({name,frame,pos,quat});
    cursor+=111;
  }
  const morphs=view.getUint32(cursor,true);cursor+=4;
  assert.equal(morphs,0);
  assert.equal(cursor+16,buffer.byteLength);
  return samples;
}

test('both standard Japanese and English foot IK rigs are recognized', () => {
  const actual = resolveWalkBones(bones);
  assert.equal(actual.leftIK, '左足ＩＫ');
  assert.equal(actual.rightIK, '右足ＩＫ');
  assert.equal(resolveWalkBones(['LeftLegIK','RightLegIK']).leftIK, 'LeftLegIK');
  assert.equal(resolveWalkBones(['左足IK','右足IK']).rightIK, '右足IK');
});

test('leg angle settings determine reach from measured legs rather than model height', () => {
  const boneRestPositions = {
    '左足': { y: 10 }, '右足': { y: 11 },
    '左足ＩＫ': { y: 1 }, '右足ＩＫ': { y: 1 }
  };
  const settings = { boneNames: bones, boneRestPositions, modelHeight: 39 };
  const gait = walkGaitFromAngles(settings);
  assert.equal(gait.legHeightSource, 'bone-rest');
  assert.equal(gait.legHeight, 9, 'shorter leg sets common support speed');
  assert.equal(gait.forwardDegrees, WALK_LEG_FORWARD_DEGREES);
  assert.equal(gait.backwardDegrees, WALK_LEG_BACKWARD_DEGREES);
  assert.equal(gait.forwardDegrees, 12);
  assert.equal(gait.backwardDegrees, 22);
  assert.equal(gait.stride, walkGaitFromAngles({ ...settings, modelHeight: 100 }).stride);
  const larger = walkGaitFromAngles({ ...settings, backwardDegrees: 24 });
  assert.ok(larger.backwardReach > gait.backwardReach);
  assert.equal(larger.forwardReach, gait.forwardReach);
  for (const config of [gait, larger]) {
    for (const direction of [-1, 1]) {
      const first = walkFootAt(0, config, direction);
      const last = walkFootAt(WALK_STANCE, config, direction);
      const angle = foot => Math.atan2(foot.x * direction, config.legHeight - foot.y) * 180 / Math.PI;
      assert.ok(Math.abs(angle(first) - config.forwardDegrees) < 1e-8);
      assert.ok(Math.abs(angle(last) + config.backwardDegrees) < 1e-8);
      for (let i = 0; i <= 360; i++) {
        const a = angle(walkFootAt(i / 360, config, direction));
        assert.ok(a <= config.forwardDegrees + 1e-8 && a >= -config.backwardDegrees - 1e-8);
      }
    }
  }
  for (const forwardDegrees of [-1, NaN, Infinity, 90]) {
    assert.throws(() => walkGaitFromAngles({ forwardDegrees }), RangeError);
  }
  assert.throws(() => walkGaitFromAngles({ forwardDegrees: 0, backwardDegrees: 0 }), RangeError);
  assert.equal(walkGaitFromAngles().legHeightSource, 'height-fallback');
});

test('walking gently curls available fingers on both hands and encodes their names', () => {
  const fingers = ['左人指１', '右人指１', '左中指2', '右中指2', '左親指０', '右親指０'];
  const samples = extractVmd(buildWalkingVmd({ boneNames: [...bones, ...fingers] }).buffer);
  for (const name of fingers) {
    const keys = samples.filter(s => s.name === name);
    assert.equal(keys.length, WALK_FRAMES / 2 + 1);
    assert.deepEqual(keys[0].quat, keys.at(-1).quat);
    assert.ok(keys.every(k => k.quat.every(Number.isFinite)));
    const axis = name.includes('親指') ? 1 : 2;
    assert.ok(keys[0].quat[axis] * (name.startsWith('左') ? -1 : 1) > 0);
    const degrees = 2 * Math.acos(keys[0].quat[3]) * 180 / Math.PI;
    assert.ok(degrees > 5 && degrees < 35, 'finger curl is relaxed');
  }
  assert.equal(samples.length, (bones.length + fingers.length) * (WALK_FRAMES / 2 + 1));
});

test('procedural walk rejects PMX models without both legs IK', () => {
  assert.throws(() => buildWalkingVmd({boneNames:['左腕'],direction:1}), /左右の足IK/);
  assert.throws(() => buildWalkingVmd({boneNames:['左足ＩＫ'],direction:1}), /左右の足IK/);
});

test('walk VMD contains only matching bones and is a seamless loop', () => {
  const {buffer, stride, frames, gait} = buildWalkingVmd({boneNames:bones,modelHeight:15,direction:1});
  assert.equal(frames, WALK_FRAMES);
  assert.equal(stride, gait.forwardReach + gait.backwardReach);
  const samples = extractVmd(buffer);
  assert.equal(samples.length, bones.length * (WALK_FRAMES/2 + 1));
  for (const bone of bones) {
    const frames = samples.filter(s=>s.name===bone);
    assert.equal(frames.length, WALK_FRAMES/2+1);
    assert.equal(frames[0].frame,0);
    assert.equal(frames.at(-1).frame,WALK_FRAMES);
    for (let k=0;k<3;k++) assert.ok(Math.abs(frames[0].pos[k] - frames.at(-1).pos[k]) < 1e-5);
    for (let k=0;k<4;k++) assert.ok(Math.abs(frames[0].quat[k] - frames.at(-1).quat[k]) < 1e-5);
    assert.ok(frames.every(s=>s.quat.every(Number.isFinite)));
  }
});

test('walking chest and hips face the direction of travel while head stays slightly open', () => {
  const yawDegrees = q => 2 * Math.atan2(q[1], q[3]) * 180 / Math.PI;
  for (const direction of [-1, 1]) {
    const { buffer } = buildWalkingVmd({ boneNames: bones, modelHeight: 15, direction });
    const samples = extractVmd(buffer);
    const atStart = name => samples.find(sample => sample.name === name && sample.frame === 0);
    const chestYaw = yawDegrees(atStart('上半身').quat);
    const hipYaw = yawDegrees(atStart('下半身').quat);
    const neckYaw = yawDegrees(atStart('首').quat);
    const initialTwist = 10 * Math.sin(-2 * Math.PI * WALK_STANCE / 2);
    assert.ok(Math.abs(chestYaw + direction * 90 - initialTwist) < 0.2, 'chest twists around the travel heading');
    assert.ok(Math.abs(hipYaw + direction * 90 - 8) < 0.2, 'left-leading pose twists the left hip forwards by eight degrees');
    for (const hip of samples.filter(s => s.name === '下半身')) {
      const phase = hip.frame / WALK_FRAMES;
      const gait = walkGaitFromAngles();
      const left = walkFootAt(phase, gait, direction);
      const right = walkFootAt(phase + 0.5, gait, direction);
      const footDifference = (left.x - right.x) * direction;
      const twist = yawDegrees(hip.quat) + direction * 90;
      assert.ok(twist * footDifference > 0, 'each hip follows its own leg forwards and backwards');
      assert.ok(Math.abs(twist) <= 8.01, 'pelvis twist stays within eight degrees');
    }
    for (const sample of samples.filter(s => s.name === '左足ＩＫ' || s.name === '右足ＩＫ')) {
      assert.ok(Math.abs(yawDegrees(sample.quat) + direction * 90) < 0.2,
        'both foot IK headings stay aligned with travel throughout the cycle');
    }
    assert.ok(Math.abs(neckYaw - direction * 20 + initialTwist) < 0.2, 'neck compensates torso twist');
    assert.ok(Math.abs(chestYaw + neckYaw + direction * 70) < 0.2, 'combined head yaw preserves its original heading');
    assert.ok(chestYaw * hipYaw > 0, 'torso and hips must face the same travel direction');
    for (const chest of samples.filter(s => s.name === '上半身')) {
      const at = name => samples.find(s => s.name === name && s.frame === chest.frame);
      const pitch = q => 2 * Math.atan2(q[0], q[3]);
      const armDifference = pitch(at('左腕').quat) - pitch(at('右腕').quat);
      const twist = yawDegrees(chest.quat) + direction * 90;
      // Positive local yaw brings the left shoulder (+X) forwards (-Z),
      // negative yaw brings the right shoulder forwards and the left back.
      assert.ok(twist * armDifference > 0, 'each shoulder follows its own arm forwards and backwards');
      assert.ok(Math.abs(twist) <= 10.01, 'twist stays within ten degrees');
      const cycle = Math.sin(2 * Math.PI * chest.frame / WALK_FRAMES);
      assert.ok(Math.abs(yawDegrees(chest.quat) + yawDegrees(at('首').quat) + direction * 70 + 1.5 * cycle) < 0.2,
        'face keeps its twenty-degree camera opening through the full cycle');
    }
  }
});

test('planted foot opposes window travel at constant rate', () => {
  const gait = walkGaitFromAngles();
  const { stride } = gait;
  const delta=0.07;
  const a=walkFootAt(.2,gait,1);
  const b=walkFootAt(.2+delta,gait,1);
  assert.equal(a.planted,true);
  assert.equal(b.planted,true);
  assert.ok(Math.abs((b.x-a.x) + stride*delta/WALK_STANCE) < 1e-10);
  assert.equal(a.y,0);
  assert.equal(b.y,0);
  assert.ok(Math.abs(walkTravelSpeed(stride,100)*WALK_SECONDS*WALK_STANCE-stride*100) < 1e-9);
});

test('pelvis accepts load below rest height and transfers toward alternating supports', () => {
  for (const direction of [-1, 1]) {
    const samples = extractVmd(buildWalkingVmd({ boneNames: bones, modelHeight: 15, direction }).buffer);
    const groove = frame => samples.find(s => s.name === 'グルーブ' && s.frame === frame).pos;
    assert.ok(groove(2)[1] < groove(10)[1], 'load acceptance is lower than midstance');
    assert.ok(groove(10)[2] * direction > 0, 'weight moves toward left support');
    assert.ok(groove(28)[2] * direction < 0, 'weight moves toward right support');
    const originalDip = frame => -15 * (0.003 + 0.003 * Math.cos(
      4 * Math.PI * (frame / WALK_FRAMES - (WALK_STANCE - 0.5) / 2)));
    assert.ok(Math.abs(groove(0)[1] - originalDip(0) * 0.7) < 1e-6,
      'leg endpoints ease the crouch slightly so IK can extend the knees');
    assert.ok(Math.abs(groove(18)[1] - groove(0)[1]) < 1e-6,
      'both legs receive the same relief half a cycle apart');
    for (const sample of samples.filter(s => s.name === 'グルーブ')) {
      assert.equal(sample.pos[0], 0);
      assert.ok(sample.pos[1] <= 0, 'pelvis must not overextend legs above rest');
      const dip = originalDip(sample.frame);
      assert.ok(sample.pos[1] >= dip - 1e-6 && sample.pos[1] <= dip * 0.7 + 1e-6,
        'retain at least seventy percent of the existing dip rather than locking the knees');
    }
    for (const [name, offset] of [['左足ＩＫ', 0], ['右足ＩＫ', 0.5]]) {
      for (const sample of samples.filter(s => s.name === name)) {
        const foot = walkFootAt(sample.frame / WALK_FRAMES + offset, walkGaitFromAngles({ modelHeight: 15 }), direction);
        const roll = walkFootRollAt(sample.frame / WALK_FRAMES + offset, 15 * 0.022, 15 * 0.023);
        assert.ok(Math.abs(sample.pos[0] - foot.x - direction * roll.x) < 1e-6);
        assert.ok(Math.abs(sample.pos[1] - foot.y - roll.y) < 1e-6);
        assert.equal(sample.pos[2], 0);
      }
    }
  }
});

test('arms oppose the ipsilateral foot without reversing local swing on a left turn', () => {
  for (const direction of [-1, 1]) {
    const samples = extractVmd(buildWalkingVmd({ boneNames: bones, direction }).buffer);
    for (const frame of [0, 18]) {
      const at = name => samples.find(s => s.name === name && s.frame === frame);
      const footForward = at('左足ＩＫ').pos[0] * direction;
      // Positive arm X pitches the lowered hand forwards (-Z in MMD).
      assert.ok(at('左腕').quat[0] * footForward < 0);
      assert.ok(at('右腕').quat[0] * footForward > 0);
      assert.ok(at('左ひじ').quat[1] > 0, 'left forearm bends forwards from +X');
      assert.ok(at('右ひじ').quat[1] < 0, 'right forearm bends forwards from -X');
      const armPitch = q => 2 * Math.atan2(q[0], q[3]) * 180 / Math.PI;
      const leadingArm = footForward > 0 ? at('右腕') : at('左腕');
      const leadingPitch = armPitch(leadingArm.quat);
      assert.ok(leadingPitch > 16 && leadingPitch <= 17.01, 'opposite arm swings forwards up to seventeen degrees');
      const trailingArm = footForward > 0 ? at('左腕') : at('右腕');
      const trailingPitch = armPitch(trailingArm.quat);
      assert.ok(trailingPitch < -15 && trailingPitch >= -17.01, 'backswing reaches up to seventeen degrees');
    }
  }
});

test('swing foot lifts and returns to its first position without discontinuity', () => {
  const gait = walkGaitFromAngles();
  const middle=walkFootAt((WALK_STANCE+1)/2,gait,-1);
  assert.equal(middle.planted,false);
  assert.ok(Math.abs(middle.y-gait.lift)<1e-10);
  assert.equal(gait.lift, 0.5 * Math.min(10 * 0.025, gait.legHeight * 0.12),
    'lift is half of the original height');
  const first=walkFootAt(0,gait,-1), last=walkFootAt(1,gait,-1);
  assert.deepEqual(first,last);
  assert.ok(walkFootAt(.75,gait,1).y>0);
});

test('trailing foot stays behind longer and releases toe-down without changing contact speed', () => {
  for (const direction of [-1, 1]) {
    const gait = walkGaitFromAngles();
    const start = walkFootAt(0, gait, direction);
    const release = walkFootAt(WALK_STANCE, gait, direction);
    assert.ok(-release.x * direction > start.x * direction, 'more reach behind than ahead');
    assert.ok(walkFootAt(WALK_STANCE * 0.4, gait, direction).x * direction < 0,
      'foot passes behind the body earlier during stance');
    const before = walkFootAt(WALK_STANCE - 1e-7, gait, direction);
    assert.ok(Math.abs(before.x - release.x) < 1e-6, 'release position is continuous');
    const samples = extractVmd(buildWalkingVmd({ boneNames: bones, direction }).buffer);
    for (const sample of samples.filter(s => s.name === '左足ＩＫ' || s.name === '右足ＩＫ')) {
      const phase = sample.frame / WALK_FRAMES + (sample.name === '右足ＩＫ' ? 0.5 : 0);
      const p = phase % 1;
      const pitch = 2 * Math.atan2(sample.quat[0], sample.quat[3]);
      const expected = walkFootRollAt(p, 10 * 0.022, 10 * 0.023);
      assert.ok(Math.abs(pitch - expected.pitch) < 1e-6, 'both ankles follow the heel-to-toe roll');
    }
  }
});

test('twenty-five degree heel lift and heel-first landing keep the sole pivot on its support path', () => {
  const toe = 0.84, ankle = 0.9;
  const gait = walkGaitFromAngles();
  const passingStance = WALK_STANCE * gait.forwardReach / gait.stride;
  assert.ok(Math.abs(walkFootRollAt(0, toe, ankle).pitch * 180 / Math.PI - 15) < 1e-9,
    'forward endpoint raises the toes fifteen degrees');
  assert.ok(Math.abs(walkFootRollAt(passingStance, toe, ankle).pitch) < 1e-9,
    'sole is level when the support passes underneath');
  // Find passing from the actual swing trajectory, rather than assuming
  // that the delayed, asymmetric stride crosses at half the swing time.
  let lo = WALK_STANCE, hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (walkFootAt(mid, gait).x < 0) lo = mid;
    else hi = mid;
  }
  const passingSwing = (lo + hi) / 2;
  assert.ok(Math.abs(walkFootRollAt(passingSwing, toe, ankle, gait).pitch) < 1e-9,
    'swing foot also passes underneath with a level sole');
  assert.ok(walkFootAt(passingSwing, gait).y <= gait.legHeight * 0.06);
  assert.ok(walkFootRollAt(0.6, toe, ankle).pitch < 0, 'heel lifts before release');
  assert.ok(Math.abs(walkFootRollAt(WALK_STANCE, toe, ankle).pitch * 180 / Math.PI + 25) < 1e-9,
    'heel lift reaches twenty-five degrees at release');
  assert.ok(walkFootRollAt(0.99, toe, ankle).pitch > 0, 'toe-up approach to heel contact');
  assert.deepEqual(walkFootRollAt(0, toe, ankle), walkFootRollAt(1, toe, ankle));
  for (let i = 0; i <= 100; i++) {
    const roll = walkFootRollAt(i / 100, toe, ankle);
    assert.ok(roll.pitch >= -25.001 * Math.PI / 180 && roll.pitch <= 15.001 * Math.PI / 180);
    const pivotZ = roll.pitch < 0 ? -toe : toe * 0.35;
    const rotatedForward = ankle * Math.sin(roll.pitch) - pivotZ * Math.cos(roll.pitch);
    const rotatedHeight = -ankle * Math.cos(roll.pitch) - pivotZ * Math.sin(roll.pitch);
    assert.ok(Math.abs(roll.x + rotatedForward + pivotZ) < 1e-9, 'contact does not drift horizontally');
    assert.ok(Math.abs(roll.y + rotatedHeight + ankle) < 1e-9, 'contact does not sink or float');
  }
  for (const seam of [0, passingStance, passingSwing, WALK_STANCE, 1]) {
    const a = walkFootRollAt(seam - 1e-7, toe, ankle);
    const b = walkFootRollAt(seam + 1e-7, toe, ankle);
    assert.ok(Math.abs(a.pitch - b.pitch) < 1e-5 && Math.abs(a.y - b.y) < 1e-5);
  }
});

test('rest stance width does not give one leg more trailing reach than the other', () => {
  const boneRestPositions = {
    '左足ＩＫ': { x: 0.65, z: 0.26 },
    '右足ＩＫ': { x: -0.65, z: 0.26 }
  };
  for (const direction of [-1, 1]) {
    const samples = extractVmd(buildWalkingVmd({ boneNames: bones, boneRestPositions, direction }).buffer);
    for (const left of samples.filter(s => s.name === '左足ＩＫ' && s.frame < WALK_FRAMES)) {
      const right = samples.find(s => s.name === '右足ＩＫ' && s.frame === (left.frame + WALK_FRAMES / 2) % WALK_FRAMES);
      assert.ok(Math.abs((left.pos[0] + 0.65) - (right.pos[0] - 0.65)) < 1e-6,
        'absolute fore/aft targets match half a cycle apart');
      assert.ok(Math.abs(left.pos[1] - right.pos[1]) < 1e-6);
      assert.ok(Math.abs(left.pos[2] + right.pos[2]) < 1e-6, 'stance width mirrors across the path');
      for (let k = 0; k < 4; k++) assert.ok(Math.abs(left.quat[k] - right.quat[k]) < 1e-6);
    }
  }
});
