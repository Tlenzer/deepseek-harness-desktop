const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  shell,
} = require('electron');
const { HarnessRuntime, fetchHarnessPage } = require('./harness-runtime');

const isSmokeTest = process.argv.includes('--smoke-test');
const projectRoot = path.resolve(__dirname, '..');
let mainWindow = null;
let runtime = null;
let quitting = false;

app.setAppUserModelId('io.github.tlenzer.deepseek-harness-desktop');

function appendLog(message) {
  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(path.join(directory, 'desktop.log'), line, 'utf8');
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readSavedWorkspace() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return typeof settings.workspace === 'string' ? settings.workspace : null;
  } catch {
    return null;
  }
}

function saveWorkspace(workspace) {
  const filename = settingsPath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify({ workspace }, null, 2)}\n`, 'utf8');
}

async function resolveWorkspace() {
  const requested = argumentValue('--workspace') || process.env.DSH_WORKSPACE;
  const candidates = [
    requested,
    readSavedWorkspace(),
    app.getPath('documents'),
    app.getPath('home'),
  ];

  if (requested && fs.existsSync(requested) && !isSmokeTest) {
    saveWorkspace(path.resolve(requested));
  }

  const existing = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (requested || readSavedWorkspace() || isSmokeTest) return existing;

  const selection = await dialog.showOpenDialog({
    title: '选择 DeepSeek Harness 默认工作区',
    defaultPath: existing,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '选择工作区',
  });

  if (!selection.canceled && selection.filePaths[0]) {
    const workspace = selection.filePaths[0];
    saveWorkspace(workspace);
    return workspace;
  }

  return existing;
}

function createWindow() {
  const icon = path.join(projectRoot, 'assets', 'icon.png');
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#07111f',
    title: 'DeepSeek Harness',
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:deepseek-harness-desktop',
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (runtime?.url && url.startsWith(runtime.url)) {
      void window.loadURL(url);
      return { action: 'deny' };
    }
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (runtime?.url && url.startsWith(runtime.url)) return;
    event.preventDefault();
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
  });
  window.on('closed', () => {
    mainWindow = null;
  });

  mainWindow = window;
  return window;
}

async function quitGracefully(exitCode = 0) {
  if (quitting) return;
  quitting = true;
  try {
    await runtime?.stop();
  } catch (error) {
    appendLog(`Shutdown error: ${error.stack || error.message}`);
  }
  app.exit(exitCode);
}

async function runSmokeTest() {
  const url = await runtime.start();
  const readiness = await fetchHarnessPage(`${url}/`, 10_000);
  const result = {
    ok: readiness.ok,
    status: readiness.status,
    titleMatch: readiness.titleMatch,
    packaged: app.isPackaged,
    nodeRuntime: runtime.resolvePaths().node,
    dshEntry: runtime.resolvePaths().dshEntry,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await runtime.stop();
  app.exit(result.ok ? 0 : 1);
}

async function boot() {
  nativeTheme.themeSource = 'system';
  const workspace = await resolveWorkspace();
  const dshHome = path.join(app.getPath('userData'), 'dsh');

  runtime = new HarnessRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot,
    workspace,
    dshHome,
    log: appendLog,
  });

  runtime.on('unexpected-exit', ({ code }) => {
    appendLog(`Runtime stopped unexpectedly with code ${code}.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(projectRoot, 'src', 'runtime-error.html'));
    }
  });

  if (isSmokeTest) {
    await runSmokeTest();
    return;
  }

  const window = createWindow();
  await window.loadFile(path.join(projectRoot, 'src', 'loading.html'));
  const url = await runtime.start();
  await window.loadURL(url);
}

const hasInstanceLock = isSmokeTest || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else if (!isSmokeTest) {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
}

if (hasInstanceLock) {
  app.whenReady().then(boot).catch(async (error) => {
    appendLog(`Startup error: ${error.stack || error.message}`);
    if (!isSmokeTest) {
      dialog.showErrorBox('DeepSeek Harness 启动失败', error.message);
    } else {
      process.stderr.write(`${error.stack || error.message}\n`);
    }
    await quitGracefully(1);
  });
}

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  void quitGracefully(0);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void quitGracefully(0);
  }
});

app.on('activate', () => {
  if (!mainWindow && runtime?.url) {
    const window = createWindow();
    void window.loadURL(runtime.url);
  }
});
