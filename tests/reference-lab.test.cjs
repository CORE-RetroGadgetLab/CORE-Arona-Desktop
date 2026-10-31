'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  SOURCES, VIEWS, FRAMES, EXPECTED, referenceRoot, beginReferenceCapture,
  saveReferenceImage, finishReferenceCapture, writeReferenceComparison
} = require('../electron/reference-lab.cjs');

const png = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4uMAAAAASUVORK5CYII=';

test('reference sources and camera checkpoints are fixed and private', () => {
  assert.deepEqual(SOURCES,['threejs','quaternius']);
  assert.deepEqual(VIEWS,['front','three-quarter','side']);
  assert.deepEqual(FRAMES,[0,4,8,12,16,20,24,28,32]);
  assert.equal(EXPECTED.size,30);
  assert.throws(() => referenceRoot('/tmp/motion-lab','../outside'));
});

test('reference captures reject arbitrary file writes and incomplete sessions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'frame-ref-lab-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const session = await beginReferenceCapture(root,'threejs');
  await assert.rejects(saveReferenceImage(session,'../../avatar.png',png));
  await assert.rejects(saveReferenceImage(session,'reference-front-f01.png',png));
  await assert.rejects(saveReferenceImage(session,'reference-front-f00.png','hello'));
  await assert.rejects(finishReferenceCapture(session,{clip:'Walk'}),/incomplete/);
  for (const name of EXPECTED) await saveReferenceImage(session,name,png);
  await assert.rejects(saveReferenceImage(session,'reference-front-f00.png',png));
  const dir = await finishReferenceCapture(session,{
    fileName:'Soldier.glb',clip:'Walk',duration:1.03
  });
  const meta = JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
  assert.equal(meta.source,'threejs');
  assert.equal(meta.sourceModelFileSaved,false);
  assert.equal(meta.files.length,30);
  assert.equal(meta.framePhases[0],0);
  assert.equal(meta.framePhases.at(-1),+((32/36).toFixed(6)));
  assert.match(meta.alignment,/no automatic foot-contact sync/);
  const gallery = await fs.readFile(path.join(dir,'index.html'),'utf8');
  assert.match(gallery,/reference-front-f00.png/);
  assert.match(gallery,/sheet-side.png/);
  const latest = JSON.parse(await fs.readFile(path.join(root,'references','threejs','latest.json'),'utf8'));
  assert.match(latest.folder,/^runs\//);
  const compare = await writeReferenceComparison(root);
  const html = await fs.readFile(compare,'utf8');
  assert.match(html,/three.js/);
  assert.match(html,/sheet-front.png/);
  assert.match(html,/FRAME未撮影/);
});

test('comparison links FRAME, three.js and Quaternius without copying source GLBs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'frame-ref-compare-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const frameRun = '2026-11-01T00-00-00-000Z-12345678';
  await fs.mkdir(path.join(root,'runs',frameRun),{recursive:true});
  await fs.writeFile(path.join(root,'runs',frameRun,'manifest.json'),'{}');
  await fs.writeFile(path.join(root,'latest.json'),JSON.stringify({folder:'runs/'+frameRun}));
  const ref = await beginReferenceCapture(root,'quaternius');
  for (const name of EXPECTED) await saveReferenceImage(ref,name,png);
  await finishReferenceCapture(ref,{fileName:'Walk.glb',clip:'WalkForward'});
  const html = await fs.readFile(await writeReferenceComparison(root),'utf8');
  assert.ok(html.includes('runs/'+frameRun+'/sheet-left-side.png'));
  assert.ok(html.includes('references/quaternius/runs/'));
  assert.ok(html.includes('sheet-three-quarter.png'));
  assert.ok(!html.includes('Walk.glb'));
});

test('reference gallery escapes locally selected names', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'frame-ref-xss-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const ref = await beginReferenceCapture(root,'threejs');
  for (const name of EXPECTED) await saveReferenceImage(ref,name,png);
  const dir = await finishReferenceCapture(ref,{
    fileName:'<img src=x onerror=alert(1)>.glb',
    clip:'<script>alert(1)</script>'
  });
  const html = await fs.readFile(path.join(dir,'index.html'),'utf8');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
