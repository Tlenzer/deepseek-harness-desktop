const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = __dirname;
const dshRoot = path.join(projectRoot, 'runtime');

function isSupportedNode(executable) {
  if (!executable || !fs.existsSync(executable)) return false;

  try {
    const version = execFileSync(executable, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const match = /^v(\d+)\.(\d+)\./.exec(version);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return (major === 22 && minor >= 19) || major >= 24;
  } catch {
    return false;
  }
}

function resolveNodeRuntime() {
  const candidates = [];

  if (process.env.DSH_NODE_PATH) {
    candidates.push(process.env.DSH_NODE_PATH);
  }

  if (process.platform === 'win32') {
    const packageRoot = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WinGet',
      'Packages',
    );

    if (fs.existsSync(packageRoot)) {
      for (const directory of fs.readdirSync(packageRoot)) {
        if (!directory.startsWith('OpenJS.NodeJS.LTS_')) continue;
        const installRoot = path.join(packageRoot, directory);
        for (const child of fs.readdirSync(installRoot)) {
          if (child.startsWith('node-v')) {
            candidates.push(path.join(installRoot, child, 'node.exe'));
          }
        }
      }
    }
  }

  candidates.push(
    path.join(
      os.homedir(),
      '.cache',
      'codex-runtimes',
      'codex-primary-runtime',
      'dependencies',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    ),
    process.execPath,
  );

  const executable = candidates.find(isSupportedNode);
  if (!executable) {
    throw new Error('A Node.js 22.19+ or 24+ runtime is required to package DeepSeek Harness.');
  }
  return executable;
}

const nodeExecutable = resolveNodeRuntime();
const nodeDirectory = path.dirname(nodeExecutable);
const dshEntry = path.join(
  dshRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'lib',
  'bin.js',
);

if (!fs.existsSync(dshEntry)) {
  throw new Error(`DeepSeek Harness runtime was not found at ${dshEntry}`);
}

module.exports = {
  appId: 'io.github.tlenzer.deepseek-harness-desktop',
  productName: 'DeepSeek Harness Desktop',
  copyright: 'Copyright © 2026 Tlenzer and contributors',
  asar: true,
  npmRebuild: false,
  compression: 'normal',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: [
    'src/**/*',
    'assets/icon.png',
    'LICENSE',
    'NOTICE.md',
    'README.md',
    'package.json',
  ],
  extraResources: [
    {
      from: path.join(dshRoot, 'node_modules'),
      to: 'dsh/node_modules',
    },
    {
      from: path.join(dshRoot, 'package.json'),
      to: 'dsh/package.json',
    },
    {
      from: path.join(dshRoot, 'package-lock.json'),
      to: 'dsh/package-lock.json',
    },
    {
      from: nodeDirectory,
      to: 'runtime',
      filter: ['**/*', '!node_modules/**/*'],
    },
    {
      from: path.join(nodeDirectory, 'node_modules'),
      to: 'runtime/node_modules',
    },
    {
      from: path.join(projectRoot, 'scripts', 'runtime-shims'),
      to: 'runtime',
    },
    {
      from: path.join(projectRoot, 'src', 'dsh-runner.mjs'),
      to: 'runtime/dsh-runner.mjs',
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    artifactName: 'DeepSeek-Harness-Desktop-${version}-Setup.${ext}',
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DeepSeek Harness',
    uninstallDisplayName: 'DeepSeek Harness Desktop',
    runAfterFinish: true,
  },
};
