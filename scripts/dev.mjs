import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();

const electronCli = fileURLToPath(new URL('../node_modules/electron/cli.js', import.meta.url));
const app = spawn(process.execPath, [electronCli, '.'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, DESKISLAND_DEV_URL: server.resolvedUrls.local[0] },
  stdio: 'inherit',
});

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (app.exitCode === null) app.kill();
  await server.close();
  process.exitCode = exitCode;
}

app.once('error', (error) => {
  console.error('Failed to start Electron:', error);
  void stop(1);
});
app.once('exit', (code) => void stop(code ?? 0));
process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));
