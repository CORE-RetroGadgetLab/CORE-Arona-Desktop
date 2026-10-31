// Standalone, local-only GLB inspector. No MMD bone edits or retargeting.
import '@babylonjs/loaders/glTF/2.0';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

const FRAMES = Object.freeze([0,4,8,12,16,20,24,28,32]);
const VIEWS = Object.freeze(['front','three-quarter','side']);
const LABELS = { front:'FRONT', 'three-quarter':'3/4', side:'SIDE' };
const ALPHAS = { front:-Math.PI/2, 'three-quarter':-Math.PI/4, side:0 };
const canvas = document.getElementById('reference-canvas');
const input = document.getElementById('reference-file');
const select = document.getElementById('reference-clip');
const source = document.getElementById('reference-source');
const preview = document.getElementById('preview');
const capture = document.getElementById('capture');
const compare = document.getElementById('compare');
const status = document.getElementById('status');
const clipInfo = document.getElementById('clip-info');
const stageLabel = document.getElementById('stage-label');
const engine = new Engine(canvas, true, { preserveDrawingBuffer:true, premultipliedAlpha:false });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.588,0.604,0.643,1);
const camera = new ArcRotateCamera('reference-camera', -Math.PI/2, Math.PI/2, 6, Vector3.Zero(), scene);
camera.fov = 0.7;
camera.minZ = 0.01;
const ambient = new HemisphericLight('lab-fill', new Vector3(0,1,0),scene);
ambient.intensity = 1.25;
const key = new DirectionalLight('lab-key',new Vector3(-0.6,-1,0.8),scene);
key.intensity = 0.9;
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize',() => engine.resize());

let model = null;
let fileName = '';
let group = null;
let playing = false;
let recording = false;
let view = 'front';
let loadId = 0;

function say(message, error=false) {
  status.textContent = String(message);
  status.classList.toggle('error',Boolean(error));
}
function chooseView(next) {
  view = next;
  camera.alpha = ALPHAS[next];
  for (const button of document.querySelectorAll('[data-view]')) {
    const on = button.dataset.view === next;
    button.classList.toggle('selected',on);
    button.setAttribute('aria-pressed',String(on));
  }
  stageLabel.textContent = group ? (LABELS[next] + ' / ' + group.name) : 'NO MODEL';
}
function fitCamera(container) {
  const meshes = container.meshes.filter(mesh => typeof mesh.getTotalVertices === 'function' &&
    mesh.getTotalVertices() > 0);
  if (!meshes.length) throw new Error('メッシュが見つかりません。モデルを含むGLBを選択してください');
  let min = null, max = null;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const lo = bounds.minimumWorld, hi = bounds.maximumWorld;
    min = min ? Vector3.Minimize(min,lo) : lo.clone();
    max = max ? Vector3.Maximize(max,hi) : hi.clone();
  }
  const center = min.add(max).scale(0.5);
  const height = Math.max(0.1,max.y-min.y);
  const width = Math.max(0.1,max.x-min.x,max.z-min.z);
  const radius = Math.max(height/(2*Math.tan(camera.fov/2)),
    width/(2*Math.tan(camera.fov/2)*0.65),0.8)*1.32;
  camera.setTarget(center);
  camera.beta = Math.PI/2;
  camera.radius = radius;
  chooseView(view);
}
function activeDuration() {
  if (!group) return 0;
  const fps = group.targetedAnimations?.[0]?.animation?.framePerSecond || 60;
  return (group.to - group.from)/fps;
}
function chooseClip() {
  if (group) group.stop();
  const i = Number(select.value);
  group = model?.animationGroups?.[i] || null;
  if (!group) {
    preview.disabled = capture.disabled = true;
    playing = false;
    stageLabel.textContent = 'NO CLIP';
    return;
  }
  group.start(true,1,group.from,group.to);
  group.pause();
  playing = false;
  preview.disabled = capture.disabled = false;
  group.goToFrame(group.from);
  chooseView(view);
  const duration = activeDuration();
  clipInfo.textContent = group.name + ' / 約' + (duration ? duration.toFixed(2) : '?') + '秒。' +
    ' 接地位相は未校正です。';
  say('準備完了。再生で確認、撮影で3視点の比較資料を生成できます。');
}
input.addEventListener('change',async () => {
  const file = input.files?.[0];
  if (!file) return;
  if (!/\.glb$/i.test(file.name) || file.size < 24 || file.size > 64*1024*1024) {
    say('64MB以下の .glb ファイルを選択してください。FBX/glTF(JSON)は非対応です。',true);
    return;
  }
  const request = ++loadId;
  input.disabled = true;
  capture.disabled = preview.disabled = select.disabled = true;
  say('GLBをローカルで読み込み中です…');
  try {
    if (group) group.stop();
    group = null;
    if (model) { model.dispose(); model = null; }
    const container = await LoadAssetContainerAsync(file,scene);
    if (request !== loadId) { container.dispose(); return; }
    container.addAllToScene();
    try { fitCamera(container); }
    catch (error) { container.dispose(); throw error; }
    if (!container.animationGroups?.length) {
      container.dispose();
      throw new Error('アニメーションがありません。モーション付きGLBを選択してください');
    }
    model = container;
    fileName = file.name;
    select.replaceChildren();
    model.animationGroups.forEach((item,index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = item.name || 'Animation ' + index;
      select.appendChild(option);
    });
    const walkIndex = model.animationGroups.findIndex(anim =>
      /(^|[_\s.-])walk([_\s.-]|$)/i.test(anim.name));
    select.value = String(Math.max(0,walkIndex));
    select.disabled = false;
    chooseClip();
    say('読み込み成功: ' + file.name + ' / ' +
      model.animationGroups.length + 'クリップ。歩行クリップを確認してください。');
  } catch (error) {
    console.error('[Reference Lab] GLB load failed:',error);
    say('GLBの読み込みに失敗: ' + String(error?.message ?? error).slice(0,280),true);
  } finally {
    input.disabled = false;
  }
});
select.addEventListener('change',chooseClip);
document.querySelectorAll('[data-view]').forEach(button =>
  button.addEventListener('click',() => chooseView(button.dataset.view)));
preview.addEventListener('click',() => {
  if (!group || recording) return;
  if (playing) { group.pause(); playing = false; }
  else { group.play(true); playing = true; }
  say(playing ? 'プレビューを再生中です。' : 'プレビューを停止しました。');
});
function shotCanvas(label) {
  const factor = Math.min(1,960/canvas.width,1440/canvas.height);
  const result = document.createElement('canvas');
  result.width = Math.max(1,Math.round(canvas.width*factor));
  result.height = Math.max(1,Math.round(canvas.height*factor));
  const ctx = result.getContext('2d',{alpha:false});
  ctx.fillStyle = '#969AA4';
  ctx.fillRect(0,0,result.width,result.height);
  ctx.drawImage(canvas,0,0,result.width,result.height);
  ctx.fillStyle = 'rgba(29,29,31,0.85)';
  ctx.fillRect(0,0,result.width,24);
  ctx.font = 'bold 12px Segoe UI,sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label,9,17);
  return result;
}
function makeSheet(shots) {
  const first = shots[0];
  const factor = Math.min(1,480/first.width,720/first.height);
  const w = Math.round(first.width*factor),h = Math.round(first.height*factor);
  const pad = 8, label = 30;
  const sheet = document.createElement('canvas');
  sheet.width = 3*w+4*pad;
  sheet.height = 3*(h+label)+4*pad;
  const ctx = sheet.getContext('2d',{alpha:false});
  ctx.fillStyle='#20242c';
  ctx.fillRect(0,0,sheet.width,sheet.height);
  shots.forEach((shot,index) => {
    const x = pad+(index%3)*(w+pad);
    const y = pad+Math.floor(index/3)*(h+label+pad);
    ctx.drawImage(shot,x,y,w,h);
    ctx.font='bold 15px Segoe UI,sans-serif';
    ctx.fillStyle='#f5f5f7';
    ctx.fillText('F'+String(FRAMES[index]).padStart(2,'0')+' / '+ (FRAMES[index]/36*100).toFixed(0)+'%',x+6,y+h+21);
  });
  return sheet;
}
capture.addEventListener('click',async () => {
  if (!model || !group || recording) return;
  const current = group;
  const selected = source.value;
  const previousView = view;
  recording = true;
  capture.disabled = preview.disabled = select.disabled = input.disabled = true;
  if (playing) { current.pause(); playing = false; }
  let id = null;
  try {
    const started = await window.frameReferences.begin(selected);
    id = started.id;
    const count = VIEWS.length*FRAMES.length;
    let done = 0;
    for (const angle of VIEWS) {
      chooseView(angle);
      const shots = [];
      for (const frame of FRAMES) {
        // F00...F32 sample the same fraction of each clip, not foot contact.
        const phase = frame/36;
        const animationFrame = current.from+(current.to-current.from)*phase;
        current.goToFrame(animationFrame);
        scene.render();
        const png = shotCanvas(LABELS[angle]+' / '+current.name+' / F'+String(frame).padStart(2,'0'));
        shots.push(png);
        const name = 'reference-'+angle+'-f'+String(frame).padStart(2,'0')+'.png';
        await window.frameReferences.save(id,name,png.toDataURL('image/png'));
        done++;
        say('撮影中: '+done+' / '+count+' コマ');
      }
      const sheet = makeSheet(shots);
      await window.frameReferences.save(id,'sheet-'+angle+'.png',sheet.toDataURL('image/png'));
    }
    const output = await window.frameReferences.finish(id,{
      fileName,clip:current.name,duration:activeDuration()
    });
    id = null;
    say('撮影完了。3視点×9コマを保存しました。\n比較ページ: '+output.comparison);
  } catch (error) {
    console.error('[Reference Lab] capture failed:',error);
    say('撮影失敗: '+String(error?.message ?? error).slice(0,280),true);
  } finally {
    if (id) {
      try { await window.frameReferences.abort(id); } catch (error) {
        console.warn('[Reference Lab] could not abort capture',error);
      }
    }
    try { current.goToFrame(current.from); } catch {}
    chooseView(previousView);
    recording = false;
    capture.disabled = preview.disabled = select.disabled = input.disabled = false;
  }
});
compare.addEventListener('click', async () => {
  try {
    const p = await window.frameReferences.openComparison();
    say('比較ページを開きました: '+p);
  } catch (error) {
    say('比較ページを開けません: '+String(error?.message ?? error),true);
  }
});
chooseView('front');
