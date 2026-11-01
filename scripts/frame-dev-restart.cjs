'use strict';

// Restart development FRAME only after its previous Electron process exits.
// It intentionally runs the same npm start script (Vite build + Electron)
// instead of app.relaunch(), which would reload stale dist/ content.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const [, , previousPid, projectDir, userDataDir] = process.argv;
const pid = Number(previousPid);
const logPath = path.join(userDataDir || process.cwd(), 'frame-dev-restart.log');
const log = (message) => {
  try { fs.appendFileSync(logPath, new Date().toISOString() + ' ' + message + '\n'); }
  catch { /* Failure to write the diagnostic log must not block restart. */ }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(target) {
  try { process.kill(target, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function restart() {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid ||
      typeof projectDir !== 'string' || !path.isAbsolute(projectDir) ||
      !fs.existsSync(path.join(projectDir, 'package.json'))) {
    log('Invalid restart arguments');
    return;
  }
  // The original app can take a moment to finish its exit warp and
  // close VoiSona integrations. Never start a second FRAME during shutdown.
  for (let attempt = 0; attempt < 900 && alive(pid); attempt++) {
    await sleep(100);
  }
  if (alive(pid)) {
    log('Previous Electron process did not exit within 90 seconds; restart cancelled');
    return;
  }
  await sleep(350); // Allow the old npm start script to release its child.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = isWindows ? ['/d', '/s', '/c', 'npm start'] : ['start'];
  let fd;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fd = fs.openSync(logPath, 'a');
    const child = spawn(command, args, {
      cwd: projectDir,
      detached: true,
      windowsHide: isWindows,
      stdio: ['ignore', fd, fd],
      env
    });
    if (!child.pid) throw new Error('npm start process did not launch');
    log('Started npm start process ' + child.pid + ' in ' + projectDir);
    child.unref();
  } catch (error) {
    log('Restart failed: ' + String(error?.message || error));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

void restart().catch(error => { log(String(error?.stack || error)); process.exitCode = 1; });
