import { pathToFileURL } from 'node:url';

const dshEntry = process.env.DSH_DESKTOP_ENTRY;
const dshArguments = JSON.parse(process.env.DSH_DESKTOP_ARGS || '[]');

if (!dshEntry) {
  throw new Error('DSH_DESKTOP_ENTRY is missing.');
}

process.argv = [process.execPath, dshEntry, ...dshArguments];

let stopping = false;
function requestShutdown() {
  if (stopping) return;
  stopping = true;
  process.emit('SIGTERM');
  setTimeout(() => process.exit(0), 7000);
}

process.on('message', (message) => {
  if (message?.type === 'shutdown') requestShutdown();
});
process.once('disconnect', requestShutdown);

await import(pathToFileURL(dshEntry).href);
