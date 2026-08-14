# Build information

- Desktop shell: Electron `43.4.0`
- Packager: electron-builder `26.15.7`
- Harness: `@deepseek-ai/dsh@0.1.0-rc.6`
- Sidecar runtime: Node.js `24.14.0`
- Platform: Windows x64

## Verification checklist

1. JavaScript syntax checks for the Electron main process, IPC runner, and runtime manager.
2. Development-mode HTTP readiness check with the expected DeepSeek Harness title.
3. Packaged launch using only bundled Node and Harness dependencies.
4. Native dependency loading for `node-pty`, `sharp`, `koffi`, and `node-addon-require-builtin`.
5. Bundled npm/Corepack/pnpm command checks.
6. IPC shutdown with no listener left on the desktop port.
