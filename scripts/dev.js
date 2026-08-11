'use strict';

const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(__dirname, '..');

const env = {
  ...process.env,

  // Try to keep output readable in cmd.exe by disabling ANSI colors/spinners where supported.
  // (Some tools respect one or more of these.)
  NO_COLOR: process.env.NO_COLOR ?? '1',
  FORCE_COLOR: process.env.FORCE_COLOR ?? '0',
  TERM: process.env.TERM ?? 'dumb',

  // Suppress Vite's "CJS Node API is deprecated" warning in dev runs.
  // See: https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated
  VITE_CJS_IGNORE_WARNING: process.env.VITE_CJS_IGNORE_WARNING ?? '1',
};

function killTree(pid) {
  if (!pid) return;

  if (isWin) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore
    }
    return;
  }

  // On POSIX, when spawned as detached, the PID is the process group leader.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

function spawnNpmRun(scriptName) {
  // On some Windows + Node versions, spawning `npm.cmd` directly can fail with EINVAL.
  // Spawning through `cmd.exe` is the most compatible approach.
  if (isWin) {
    return spawn('cmd.exe', ['/d', '/s', '/c', `npm run ${scriptName}`], {
      cwd: rootDir,
      env,
      stdio: 'inherit',
      windowsHide: false,
    });
  }

  return spawn(npmCmd, ['run', scriptName], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
    detached: true,
  });
}

const children = [
  { name: 'renderer', proc: spawnNpmRun('dev:renderer') },
  { name: 'electron', proc: spawnNpmRun('dev:electron') },
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { proc } of children) {
    if (!proc || proc.killed) continue;
    killTree(proc.pid);
  }

  process.exit(exitCode);
}

for (const { name, proc } of children) {
  proc.on('error', (err) => {
    console.error(`[dev] failed to start ${name}:`, err);
    shutdown(1);
  });

  proc.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (signal) {
      console.error(`[dev] ${name} exited via signal ${signal}`);
      shutdown(1);
      return;
    }

    if (typeof code === 'number' && code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
      shutdown(code);
      return;
    }

    // If one process exits normally, stop the other too.
    shutdown(0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
