const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync, fork } = require('node:child_process');

const READY_TITLE = '<title>DeepSeek Harness</title>';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readDeepSeekApiKey(environment = process.env) {
  if (environment.DEEPSEEK_API_KEY?.trim()) {
    return environment.DEEPSEEK_API_KEY.trim();
  }

  const configPath = path.join(os.homedir(), '.deepseek', 'config.toml');
  if (!fs.existsSync(configPath)) return null;

  const contents = fs.readFileSync(configPath, 'utf8');
  const match = /^\s*api_key\s*=\s*["']([^"']+)["']\s*$/m.exec(contents);
  return match?.[1]?.trim() || null;
}

function reserveLoopbackPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const allocatedPort = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (allocatedPort) resolve(allocatedPort);
        else reject(new Error('The operating system did not allocate a local port.'));
      });
    });
  });
}

async function findFreeLoopbackPort(preferredPort = 31880) {
  try {
    return await reserveLoopbackPort(preferredPort);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    return reserveLoopbackPort(0);
  }
}

async function fetchHarnessPage(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const html = await response.text();
    return {
      ok: response.status === 200 && html.includes(READY_TITLE),
      status: response.status,
      titleMatch: html.includes(READY_TITLE),
    };
  } finally {
    clearTimeout(timer);
  }
}

class HarnessRuntime extends EventEmitter {
  constructor(options) {
    super();
    this.isPackaged = options.isPackaged;
    this.resourcesPath = options.resourcesPath;
    this.projectRoot = options.projectRoot;
    this.workspace = options.workspace;
    this.dshHome = options.dshHome;
    this.log = options.log || (() => {});
    this.child = null;
    this.url = null;
    this.stopping = false;
  }

  resolvePaths() {
    if (this.isPackaged) {
      return {
        node: path.join(this.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
        runner: path.join(this.resourcesPath, 'runtime', 'dsh-runner.mjs'),
        dshEntry: path.join(
          this.resourcesPath,
          'dsh',
          'node_modules',
          '@deepseek-ai',
          'dsh',
          'lib',
          'bin.js',
        ),
      };
    }

    const deploymentRoot = path.join(this.projectRoot, 'runtime');
    return {
      node: process.env.DSH_NODE_PATH || this.findDevelopmentNode(),
      runner: path.join(this.projectRoot, 'src', 'dsh-runner.mjs'),
      dshEntry:
        process.env.DSH_ENTRY ||
        path.join(
          deploymentRoot,
          'node_modules',
          '@deepseek-ai',
          'dsh',
          'lib',
          'bin.js',
        ),
    };
  }

  findDevelopmentNode() {
    const candidates = [process.env.npm_node_execpath];

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
    );

    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      if (directory) {
        candidates.push(path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node'));
      }
    }

    const executable = candidates.find((candidate) => {
      if (!candidate || !fs.existsSync(candidate)) return false;
      try {
        const version = execFileSync(candidate, ['--version'], {
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
    });
    if (!executable) {
      throw new Error('A supported Node.js runtime was not found for development.');
    }
    return executable;
  }

  async start() {
    if (this.child) return this.url;

    const runtime = this.resolvePaths();
    for (const [label, filename] of Object.entries(runtime)) {
      if (!fs.existsSync(filename)) {
        throw new Error(`${label} was not found: ${filename}`);
      }
    }

    fs.mkdirSync(this.dshHome, { recursive: true });
    const port = await findFreeLoopbackPort();
    this.url = `http://127.0.0.1:${port}`;

    const environment = {
      ...process.env,
      DSH_HOME: this.dshHome,
      COREPACK_HOME: path.join(this.dshHome, 'corepack'),
      DSH_DESKTOP_ENTRY: runtime.dshEntry,
      DSH_DESKTOP_ARGS: JSON.stringify([
        'web',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
      ]),
      PATH: `${path.dirname(runtime.node)}${path.delimiter}${process.env.PATH || ''}`,
      ELECTRON_RUN_AS_NODE: undefined,
    };
    delete environment.ELECTRON_RUN_AS_NODE;

    const apiKey = readDeepSeekApiKey(environment);
    if (apiKey) environment.DEEPSEEK_API_KEY = apiKey;

    this.log(`Starting dsh from ${runtime.dshEntry}`);
    this.log(`Workspace: ${this.workspace}`);
    this.log(`DSH home: ${this.dshHome}`);

    this.child = fork(runtime.runner, [], {
      execPath: runtime.node,
      execArgv: [],
      cwd: this.workspace,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.log(`[dsh] ${chunk.trimEnd()}`);
      this.emit('stdout', chunk);
    });
    this.child.stderr.on('data', (chunk) => {
      this.log(`[dsh:error] ${chunk.trimEnd()}`);
      this.emit('stderr', chunk);
    });
    this.child.once('exit', (code, signal) => {
      const wasStopping = this.stopping;
      this.log(`dsh exited code=${code} signal=${signal || 'none'}`);
      this.child = null;
      if (!wasStopping) this.emit('unexpected-exit', { code, signal });
    });

    const deadline = Date.now() + 90_000;
    let lastError = null;
    while (Date.now() < deadline) {
      if (!this.child) {
        throw new Error('DeepSeek Harness exited before its Web UI became ready.');
      }

      try {
        const readiness = await fetchHarnessPage(`${this.url}/`);
        if (readiness.ok) {
          this.log(`DeepSeek Harness ready at ${this.url}`);
          return this.url;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(350);
    }

    await this.stop();
    throw new Error(
      `DeepSeek Harness startup timed out${lastError ? `: ${lastError.message}` : '.'}`,
    );
  }

  async stop() {
    const child = this.child;
    if (!child) return;

    this.stopping = true;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    if (child.connected) {
      child.send({ type: 'shutdown' });
    } else {
      child.kill();
    }

    await Promise.race([exited, delay(7500)]);
    if (this.child && process.platform === 'win32') {
      await new Promise((resolve) => {
        execFile(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => resolve(),
        );
      });
    } else if (this.child) {
      child.kill('SIGKILL');
    }

    this.child = null;
    this.stopping = false;
  }
}

module.exports = {
  HarnessRuntime,
  fetchHarnessPage,
  readDeepSeekApiKey,
};
