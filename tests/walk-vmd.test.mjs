import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WALK_FRAMES, WALK_STANCE, WALK_SECONDS, WALK_STRIDE_HEIGHT_RATIO,
  walkFootAt, walkTravelSpeed, resolveWalkBones, buildWalkingVmd, walkArmPitchAt
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
  const {buffer, stride, frames} = buildWalkingVmd({boneNames:bones,modelHeight:15,direction:1});
  assert.equal(frames, WALK_FRAMES);
  assert.ok(Math.abs(stride-15*WALK_STRIDE_HEIGHT_RATIO)<1e-8);
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
      const left = walkFootAt(phase, 1, 0, direction);
      const right = walkFootAt(phase + 0.5, 1, 0, direction);
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
  const stride=2.4;
  const delta=0.07;
  const a=walkFootAt(.2,stride,0.6,1);
  const b=walkFootAt(.2+delta,stride,0.6,1);
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
    for (const sample of samples.filter(s => s.name === 'グルーブ')) {
      assert.equal(sample.pos[0], 0);
      assert.ok(sample.pos[1] <= 0, 'pelvis must not overextend legs above rest');
    }
    for (const [name, offset] of [['左足ＩＫ', 0], ['右足ＩＫ', 0.5]]) {
      for (const sample of samples.filter(s => s.name === name)) {
        const foot = walkFootAt(sample.frame / WALK_FRAMES + offset, 15 * WALK_STRIDE_HEIGHT_RATIO, 15 * 0.025, direction);
        assert.ok(Math.abs(sample.pos[0] - foot.x) < 1e-6);
        assert.ok(Math.abs(sample.pos[1] - foot.y) < 1e-6);
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
  const stride=2, lift=.35;
  const middle=walkFootAt((WALK_STANCE+1)/2,stride,lift,-1);
  assert.equal(middle.planted,false);
  assert.ok(Math.abs(middle.y-lift)<1e-10);
  const first=walkFootAt(0,stride,lift,-1), last=walkFootAt(1,stride,lift,-1);
  assert.deepEqual(first,last);
  assert.ok(walkFootAt(.75,stride,lift,1).y>0);
});

test('trailing foot stays behind longer and releases toe-down without changing contact speed', () => {
  for (const direction of [-1, 1]) {
    const stride = 2;
    const start = walkFootAt(0, stride, 0.3, direction);
    const release = walkFootAt(WALK_STANCE, stride, 0.3, direction);
    assert.ok(-release.x * direction > start.x * direction, 'more reach behind than ahead');
    assert.ok(walkFootAt(WALK_STANCE * 0.4, stride, 0.3, direction).x * direction < 0,
      'foot passes behind the body earlier during stance');
    const before = walkFootAt(WALK_STANCE - 1e-7, stride, 0.3, direction);
    assert.ok(Math.abs(before.x - release.x) < 1e-6, 'release position is continuous');
    const samples = extractVmd(buildWalkingVmd({ boneNames: bones, direction }).buffer);
    for (const sample of samples.filter(s => s.name === '左足ＩＫ' || s.name === '右足ＩＫ')) {
      const phase = sample.frame / WALK_FRAMES + (sample.name === '右足ＩＫ' ? 0.5 : 0);
      const p = phase % 1;
      const pitch = 2 * Math.atan2(sample.quat[0], sample.quat[3]);
      if (p < WALK_STANCE) assert.ok(Math.abs(pitch) < 1e-6, 'contact remains level');
      else if (p < (1 + WALK_STANCE) / 2) assert.ok(pitch < 0, 'toe points down after release');
      else assert.ok(pitch > 0, 'toe clears the ground before landing');
    }
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
