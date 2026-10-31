'use strict';
// Private GLB reference observations. The selected GLB is never saved by FRAME.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SOURCES = Object.freeze(['threejs', 'quaternius']);
const VIEWS = Object.freeze(['front', 'three-quarter', 'side']);
const FRAMES = Object.freeze([0, 4, 8, 12, 16, 20, 24, 28, 32]);
const MAX_BYTES = 8 * 1024 * 1024;
const EXPECTED = new Set(VIEWS.flatMap(view =>
  [...FRAMES.map(frame => 'reference-' + view + '-f' + String(frame).padStart(2,'0') + '.png'),
    'sheet-' + view + '.png']));
const SAFE_RUN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/i;
const PNG_HEADER = Buffer.from('89504e470d0a1a0a','hex');
const esc = value => String(value ?? '').slice(0,180).replace(/[&<>"']/g, v =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v]));

function referenceRoot(motionRoot, source) {
  if (!SOURCES.includes(source)) throw new Error('Unknown reference source');
  return path.join(motionRoot, 'references', source);
}

async function beginReferenceCapture(motionRoot, source) {
  const root = referenceRoot(motionRoot, source);
  const name = new Date().toISOString().replace(/[.:]/g, '-') + '-' + randomUUID().slice(0,8);
  const folder = path.join(root, 'runs', name);
  await fs.mkdir(folder, { recursive:true });
  return { id: randomUUID(), source, root, folder, names:new Set(), entries:[], bytes:0 };
}

async function saveReferenceImage(session, name, url) {
  if (!session || !EXPECTED.has(name) || session.names.has(name)) throw new Error('Invalid reference frame name');
  const prefix = 'data:image/png;base64,';
  if (typeof url !== 'string' || !url.startsWith(prefix) ||
      url.length > Math.ceil(MAX_BYTES*4/3)+100) throw new Error('Reference image exceeds size limit');
  const encoded = url.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid reference PNG');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < 24 || buffer.length > MAX_BYTES || !buffer.subarray(0,8).equals(PNG_HEADER) ||
      session.bytes + buffer.length > 150*1024*1024) throw new Error('Invalid reference PNG bytes');
  await fs.writeFile(path.join(session.folder, name), buffer, { flag:'wx' });
  session.names.add(name);
  session.entries.push(name);
  session.bytes += buffer.length;
  return session.names.size;
}

function referenceGallery(meta) {
  const sections = VIEWS.map(view => {
    const sheet = 'sheet-' + view + '.png';
    return '<section><h2>' + view + '</h2><a href="' + sheet + '"><img class="sheet" src="' +
      sheet + '" alt="' + view + ' comparison sheet"></a><div class="frames">' +
      FRAMES.map(frame => {
        const name = 'reference-' + view + '-f' + String(frame).padStart(2,'0') + '.png';
        return '<a href="' + name + '">F' + String(frame).padStart(2,'0') + '</a>';
      }).join(' ') + '</div></section>';
  }).join('');
  return '<!doctype html><html lang="ja"><meta charset="utf-8"><title>FRAME Reference Lab</title>' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\'">' +
    '<style>body{background:#14161d;color:#f5f5f7;font:15px Segoe UI,sans-serif;padding:24px}' +
    'main{max-width:1080px;margin:auto}a{color:#8ac7ff}.sheet{max-width:100%;width:840px}' +
    'section{background:#20232d;border:1px solid #353a46;padding:15px;margin:16px 0;border-radius:16px}' +
    '.frames{margin:12px 0;display:flex;gap:10px;flex-wrap:wrap}</style><main>' +
    '<h1>REFERENCE LAB / ' + esc(meta.source) + '</h1><p>Clip: ' + esc(meta.clip) +
    ' / GLB: ' + esc(meta.fileName) + ' / Duration: ' + esc(meta.duration) +
    's. Samples use ' + esc(meta.renderMode) + ' view and normalized clip time, NOT automatically aligned to foot contact.</p>' +
    sections + '<p>Local reference only. Do not upload user-selected reference GLBs or frames.</p></main></html>';
}

async function finishReferenceCapture(session, details) {
  if (session.names.size !== EXPECTED.size || [...EXPECTED].some(n => !session.names.has(n))) {
    throw new Error('Reference capture is incomplete: expected 27 frames and 3 sheets');
  }
  const meta = {
    version:1, source:session.source, createdAt:new Date().toISOString(),
    fileName:String(details?.fileName ?? '').slice(0,180),
    clip:String(details?.clip ?? '').slice(0,180),
    renderMode:['mesh','skeleton-proxy'].includes(details?.renderMode)
      ? details.renderMode : 'unknown',
    duration:Number.isFinite(details?.duration) ? Math.max(0,details.duration) : null,
    directions:['as-authored'], views:VIEWS, frames:FRAMES,
    framePhases:FRAMES.map(f => +(f/36).toFixed(6)),
    alignment:'normalized clip progress only; no automatic foot-contact sync or retargeting',
    sourceModelFileSaved:false, files:[...session.names].sort(),
    usage:'Local research only. Verify licensing before sharing images.'
  };
  await fs.writeFile(path.join(session.folder, 'manifest.json'), JSON.stringify(meta,null,2));
  await fs.writeFile(path.join(session.folder, 'index.html'), referenceGallery(meta));
  const rel = path.relative(session.root,session.folder).replaceAll('\\','/');
  await fs.writeFile(path.join(session.root,'latest.json'),JSON.stringify({
    folder:rel,manifest:rel+'/manifest.json',gallery:rel+'/index.html'
  },null,2));
  return session.folder;
}

const runPath = candidate => typeof candidate === 'string' &&
  /^runs\//.test(candidate) && SAFE_RUN.test(candidate.slice(5));
async function readLatest(root) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(root,'latest.json'),'utf8'));
    if (!runPath(data.folder)) return null;
    const folder = path.join(root, ...data.folder.split('/'));
    await fs.access(path.join(folder,'manifest.json'));
    return { folder, relative:data.folder };
  } catch { return null; }
}

async function writeReferenceComparison(motionRoot) {
  const frame = await readLatest(motionRoot);
  const refs = await Promise.all(SOURCES.map(async source =>
    ({ source, latest:await readLatest(referenceRoot(motionRoot,source)) })));
  const cell = (src, text, alt) => src ?
    '<a href="' + src + '"><img loading="lazy" src="' + src + '" alt="' + alt + '"></a>' :
    '<div class="missing">' + esc(text) + '</div>';
  const rows = VIEWS.map(view => {
    const referenceCells = refs.map(ref => {
      const p = ref.latest && ('references/'+ref.source+'/'+ref.latest.relative+'/sheet-'+view+'.png');
      return '<td>' + cell(p, '未撮影',ref.source+' '+view) + '</td>';
    }).join('');
    const frameLink = frame && (frame.relative+'/sheet-left-'+view+'.png');
    return '<tr><th colspan="3">' + esc(view) + '</th></tr><tr><td>' +
      cell(frameLink,'FRAME未撮影','FRAME '+view) + '</td>' +
      referenceCells + '</tr>';
  }).join('');
  const html = '<!doctype html><html lang="ja"><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\'">' +
    '<title>FRAME / Gait Comparison</title><style>body{background:#14161d;color:#f5f5f7;' +
    'font:14px Segoe UI,sans-serif;padding:24px}main{max-width:1500px;margin:auto}' +
    'table{border-spacing:8px;width:100%;table-layout:fixed}th{padding:12px;text-align:left;color:#9cd1ff}' +
    'td{vertical-align:top;background:#20232d;border-radius:10px;padding:8px}' +
    'img{width:100%;height:auto;display:block}p{color:#b3b9c6;line-height:1.5}' +
    '.missing{padding:35px 8px;color:#8f99a9}</style><main><h1>FRAME / REFERENCE LAB</h1>' +
    '<p>三者比較: FRAME（左向き） / three.js Soldier / Quaternius。フレーム位置は歩行周期の' +
    '進行率 F00〜F32 でサンプリング。着地位相は未調整のため、同じ番号でも同じ姿勢ではありません。' +
    '骨格・身長・カメラ構図も完全には正規化していません。画像とモデルはローカルのみ。</p>' +
    '<table><tr><th>FRAME</th><th>three.js / Soldier</th><th>Quaternius</th></tr>' +
    rows + '</table></main></html>';
  const dest = path.join(motionRoot,'compare.html');
  await fs.mkdir(motionRoot,{recursive:true});
  await fs.writeFile(dest,html);
  return dest;
}

// Keep the three newest complete reference observations per source. A folder
// with extra files, symlinks or missing snapshots is intentionally untouched.
const KEEP_REFERENCE_RUNS = 3;
async function pruneReferenceCaptures(motionRoot, source) {
  const root = referenceRoot(motionRoot, source);
  const runs = path.join(root,'runs');
  let entries;
  try { entries = await fs.readdir(runs,{withFileTypes:true}); }
  catch(error) { if(error.code === 'ENOENT') return []; throw error; }
  const candidates = entries.filter(entry => entry.isDirectory() && SAFE_RUN.test(entry.name))
    .map(entry => entry.name).sort().reverse();
  const valid = [];
  for (const name of candidates) {
    const folder = path.join(runs,name);
    try {
      const items = await fs.readdir(folder,{withFileTypes:true});
      if (items.length !== EXPECTED.size+2 || items.some(item => !item.isFile())) continue;
      const names = new Set(items.map(item => item.name));
      if (!names.has('index.html') || !names.has('manifest.json') ||
          [...EXPECTED].some(item => !names.has(item))) continue;
      const info = JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
      if (info.source !== source || info.version !== 1 ||
          !Array.isArray(info.files) || info.files.length !== EXPECTED.size ||
          !info.files.every(item => EXPECTED.has(item))) continue;
      valid.push({folder,name});
    } catch(error) {
      if(error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  const latest = await readLatest(root);
  const removed = [];
  for (const entry of valid.slice(KEEP_REFERENCE_RUNS)) {
    if (latest && latest.folder === entry.folder) continue;
    // Recheck plain files, so custom notes or interrupted saves are preserved.
    const contents = await fs.readdir(entry.folder,{withFileTypes:true});
    if (contents.length !== EXPECTED.size+2 || contents.some(item => !item.isFile())) continue;
    await fs.rm(entry.folder,{recursive:true,force:false});
    removed.push(entry.name);
  }
  return removed;
}

module.exports = {
  SOURCES,VIEWS,FRAMES,EXPECTED,referenceRoot,beginReferenceCapture,
  saveReferenceImage,finishReferenceCapture,writeReferenceComparison,
  pruneReferenceCaptures,KEEP_REFERENCE_RUNS
};
