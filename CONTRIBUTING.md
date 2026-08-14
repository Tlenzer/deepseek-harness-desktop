# Contributing

## Development setup

Use Windows x64 and Node.js 24:

```powershell
npm ci
npm run runtime:install
npm run check
npm run smoke
```

Run the desktop shell with:

```powershell
npm start -- --workspace C:\path\to\workspace
```

Build the NSIS installer with:

```powershell
npm run dist
```

Keep the DeepSeek Harness version exact in `runtime/package.json` and commit the matching `runtime/package-lock.json`. A runtime upgrade should pass both development and packaged smoke tests.
