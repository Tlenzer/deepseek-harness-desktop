const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const modulesRoot = path.join(projectRoot, 'runtime', 'node_modules');
const fallbackRoot = path.join(__dirname, 'license-fallbacks');
const outputPath = path.join(projectRoot, 'THIRD_PARTY_LICENSES.txt');

const fallbacks = new Map([
  ['@aws-sdk/credential-provider-http', 'aws-sdk-LICENSE'],
  ['@aws-sdk/credential-provider-login', 'aws-sdk-LICENSE'],
  ['@aws-sdk/nested-clients', 'aws-sdk-LICENSE'],
  ['@earendil-works/pi-ai', 'earendil-pi-LICENSE'],
  ['@koromix/koffi-win32-x64', 'koffi-LICENSE.txt'],
  ['data-uri-to-buffer', 'data-uri-to-buffer-LICENSE'],
]);

function packageDirectories() {
  const directories = [];
  const visited = new Set();

  function collect(root) {
    if (!fs.existsSync(root)) return;
    const resolvedRoot = fs.realpathSync(root);
    if (visited.has(resolvedRoot)) return;
    visited.add(resolvedRoot);

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') continue;
      const entryPath = path.join(root, entry.name);
      const packagePaths = entry.name.startsWith('@')
        ? fs
            .readdirSync(entryPath, { withFileTypes: true })
            .filter((child) => child.isDirectory())
            .map((child) => path.join(entryPath, child.name))
        : [entryPath];

      for (const packagePath of packagePaths) {
        directories.push(packagePath);
        collect(path.join(packagePath, 'node_modules'));
      }
    }
  }

  collect(modulesRoot);
  return directories;
}

function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((license) => (typeof license === 'string' ? license : license?.type))
      .filter(Boolean)
      .join(' OR ');
  }
  return 'UNKNOWN';
}

function repositoryUrl(manifest) {
  if (typeof manifest.repository === 'string') return manifest.repository;
  return manifest.repository?.url || manifest.homepage || '';
}

function licenseFiles(directory, packageName) {
  const matches = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(licen[cs]e|copying|notice)(\..*)?$/i.test(entry.name),
    )
    .map((entry) => ({
      source: `${packageName}/${entry.name}`,
      text: fs.readFileSync(path.join(directory, entry.name), 'utf8'),
    }));

  if (matches.length > 0) return matches;
  const fallback = fallbacks.get(packageName);
  if (!fallback) return [];
  return [
    {
      source: `fallback/${fallback}`,
      text: fs.readFileSync(path.join(fallbackRoot, fallback), 'utf8'),
    },
  ];
}

function normalizeLicenseText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

if (!fs.existsSync(modulesRoot)) {
  throw new Error(`Install the locked runtime first: ${modulesRoot}`);
}

const packages = [];
const documents = new Map();

for (const directory of packageDirectories()) {
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const name = manifest.name || path.basename(directory);
  const version = manifest.version || '0.0.0';
  const documentHashes = [];

  for (const document of licenseFiles(directory, name)) {
    const text = normalizeLicenseText(document.text);
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    if (!documents.has(hash)) {
      documents.set(hash, { text, sources: new Set(), packages: new Set() });
    }
    const record = documents.get(hash);
    record.sources.add(document.source);
    record.packages.add(`${name}@${version}`);
    documentHashes.push(hash);
  }

  packages.push({
    name,
    version,
    license: declaredLicense(manifest),
    repository: repositoryUrl(manifest),
    documentHashes,
  });
}

packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const orderedDocuments = [...documents.entries()].sort(([a], [b]) => a.localeCompare(b));
const labels = new Map(
  orderedDocuments.map(([hash], index) => [hash, `L${String(index + 1).padStart(3, '0')}`]),
);

const lines = [
  'THIRD-PARTY SOFTWARE LICENSES',
  '================================',
  '',
  'This file is generated from runtime/package-lock.json and the installed',
  'Windows x64 runtime tree. Package metadata and original license files remain',
  'present in the packaged application. Node.js and Electron also ship their own',
  'license bundles alongside the executable.',
  '',
  `Packages indexed: ${packages.length}`,
  `Unique license documents: ${orderedDocuments.length}`,
  '',
  'PACKAGE INDEX',
  '-------------',
];

for (const pkg of packages) {
  const docs = pkg.documentHashes.map((hash) => labels.get(hash)).join(', ') || 'DECLARATION_ONLY';
  lines.push(`${pkg.name}@${pkg.version} | ${pkg.license} | ${docs}`);
  if (pkg.repository) lines.push(`  Source: ${pkg.repository}`);
}

const declarationOnly = packages.filter((pkg) => pkg.documentHashes.length === 0);
lines.push('', 'DECLARATION-ONLY PACKAGES', '-------------------------');
if (declarationOnly.length === 0) {
  lines.push('None.');
} else {
  for (const pkg of declarationOnly) {
    lines.push(`${pkg.name}@${pkg.version} | declared license: ${pkg.license}`);
    if (pkg.repository) lines.push(`  Source: ${pkg.repository}`);
  }
}

lines.push('', 'CONSOLIDATED LICENSE TEXTS', '--------------------------');
for (const [hash, document] of orderedDocuments) {
  const label = labels.get(hash);
  lines.push(
    '',
    `===== ${label} =====`,
    `Packages: ${[...document.packages].sort().join(', ')}`,
    `Sources: ${[...document.sources].sort().join(', ')}`,
    '',
    document.text,
  );
}

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(
  `Wrote ${path.relative(projectRoot, outputPath)} (${packages.length} packages, ${orderedDocuments.length} license documents)\n`,
);
