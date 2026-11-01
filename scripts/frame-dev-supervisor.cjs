'use strict';

// Keep the npm start terminal alive through FRAME development restarts.
// Only a deliberate restart request from the Electron child starts a new build.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runChild(command, args, { cwd, env, onSpawn = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: false
    });
    onSpawn(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, pid: child.pid }));
  });
}

async function supervise({
  build,
  launch,
  requestFile,
  readRequest = filepath => fs.readFile(filepath, 'utf8'),
  clearRequest = filepath => fs.rm(filepath, { force: true }),
  announce = message => process.stdout.write(message + '\n'),
  isStopping = () => false
}) {
  let restarts = 0;
  while (!isStopping()) {
    // Invalidate any stale request from a previous launch before starting.
    await clearRequest(requestFile);
    announce(restarts ? '[FRAME] 再ビルドしています…' : '[FRAME] ビルドしています…');
    const built = await build();
    if (built.code !== 0 || built.signal || isStopping()) {
      return built.code || (isStopping() ? 0 : 1);
    }
    announce('[FRAME] 起動します。再起動後もこのターミナルを使用します。');
    const finished = await launch(requestFile);
    if (isStopping()) return 0;
    const signalText = await readRequest(requestFile).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    // The request file contains the PID of the child that made the request.
    // A failed/crashed app or a stale request must never trigger relaunch.
    if (signalText === null || signalText.trim() !== String(finished.pid)) {
      announce('[FRAME] 終了しました。');
      return finished.code ?? (finished.signal ? 1 : 0);
    }
    restarts += 1;
    announce('[FRAME] 再起動要求を受信しました。');
  }
  return 0;
}

async function main() {
  const projectDir = path.resolve(__dirname, '..');
  const electronPath = require('electron');
  const markerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-dev-'));
  const requestFile = path.join(markerDir, 'restart.request');
  const win = process.platform === 'win32';
  const npmCommand = win ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const npmArgs = win ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'];
  const electronEnv = { ...process.env, FRAME_DEV_RESTART_REQUEST_FILE: requestFile };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  let stopping = false;
  let activeChild = null;
  const run = (command, args, options) => runChild(command, args, {
    ...options,
    onSpawn: child => { activeChild = child; }
  }).finally(() => { activeChild = null; });
  const onStop = () => {
    stopping = true;
    if (activeChild && !activeChild.killed) activeChild.kill();
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
  try {
    process.exitCode = await supervise({
      requestFile,
      build: () => run(npmCommand, npmArgs, { cwd: projectDir, env: process.env }),
      launch: marker => run(electronPath, ['.'], {
        cwd: projectDir,
        env: { ...electronEnv, FRAME_DEV_RESTART_REQUEST_FILE: marker }
      }),
      isStopping: () => stopping
    });
  } finally {
    process.off('SIGINT', onStop);
    process.off('SIGTERM', onStop);
    await fs.rm(markerDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('[FRAME] 起動管理に失敗しました:', error);
    process.exitCode = 1;
  });
}

module.exports = { supervise };
