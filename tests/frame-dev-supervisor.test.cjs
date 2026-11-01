'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { supervise } = require('../scripts/frame-dev-supervisor.cjs');

async function fixture(callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-supervisor-test-'));
  try {
    return await callback(path.join(dir, 'restart.request'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('restart requests rebuild inside the same supervisor and ordinary exit stops', async () => {
  await fixture(async requestFile => {
    let builds = 0, launches = 0;
    const status = await supervise({
      requestFile,
      announce: () => {},
      build: async () => { builds += 1; return { code: 0 }; },
      launch: async marker => {
        launches += 1;
        if (launches === 1) await fs.writeFile(marker, '12345\n');
        return { pid: launches === 1 ? 12345 : 45678, code: 0 };
      }
    });
    assert.equal(status, 0);
    assert.equal(builds, 2);
    assert.equal(launches, 2);
  });
});

test('no restart on a crash, a wrong PID, or build failure', async () => {
  await fixture(async requestFile => {
    let launches = 0;
    const wrong = await supervise({
      requestFile,
      announce: () => {},
      build: async () => ({ code: 0 }),
      launch: async marker => {
        launches++;
        await fs.writeFile(marker, 'other-process');
        return { code: 5, pid: 101 };
      }
    });
    assert.equal(wrong, 5);
    assert.equal(launches, 1);
    const failed = await supervise({
      requestFile,
      announce: () => {},
      build: async () => ({ code: 2 }),
      launch: async () => { throw new Error('must not launch'); }
    });
    assert.equal(failed, 2);
  });
});
