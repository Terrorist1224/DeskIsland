import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist', 'win-x64');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) throw new Error('Installer requires a numeric release version');
const compiler = process.env.INNO_COMPILER || 'C:\\Program Files\\Inno Setup 7\\ISIDE.exe';
const temp = path.join(root, '.tmp', 'packaging');
await fs.mkdir(temp, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, npm_config_cache: path.join(root, '.tmp', 'npm-cache') };

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Packaging requires Windows x64');
await fs.access(compiler);
for (const script of ['test', 'typecheck', 'build']) {
  await run(process.execPath, [process.env.npm_execpath, 'run', script]);
}
// Rebuild only the dedicated staging directory; never copy workspace data or dependencies.
if (path.dirname(output) !== path.join(root, 'dist')) throw new Error('Invalid staging path');
await fs.rm(output, { recursive: true, force: true });
await fs.cp(path.join(root, 'node_modules', 'electron', 'dist'), output, { recursive: true });
await fs.rename(path.join(output, 'electron.exe'), path.join(output, 'DeskIsland.exe'));
await fs.rm(path.join(output, 'resources', 'default_app.asar'), { force: true });
const appDirectory = path.join(output, 'resources', 'app');
await fs.mkdir(appDirectory, { recursive: true });
for (const layer of ['main', 'preload', 'shared']) {
  await fs.cp(path.join(root, 'src', layer), path.join(appDirectory, 'src', layer), { recursive: true });
}
await fs.cp(path.join(root, 'dist', 'renderer'), path.join(appDirectory, 'dist', 'renderer'), { recursive: true });
await fs.writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({ name: packageJson.name, productName: packageJson.productName, version: packageJson.version, main: packageJson.main }, null, 2));
for (const name of ['README.md', 'CHANGELOG.md']) await fs.copyFile(path.join(root, name), path.join(output, name));
// Windows ICO supports a PNG image payload; reuse the existing artwork without raster editing.
const png = await fs.readFile(path.join(root, 'src', 'main', 'tray-icon.png'));
const icon = Buffer.alloc(22);
icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4);
icon[6] = png.readUInt32BE(16) % 256; icon[7] = png.readUInt32BE(20) % 256;
icon.writeUInt16LE(1, 10); icon.writeUInt16LE(32, 12);
icon.writeUInt32LE(png.length, 14); icon.writeUInt32LE(22, 18);
await fs.writeFile(path.join(output, 'DeskIsland.ico'), Buffer.concat([icon, png]));
const files = await fs.readdir(output, { recursive: true });
assert.ok(files.includes('DeskIsland.exe'));
assert.ok(files.includes(path.join('resources', 'app', 'dist', 'renderer', 'index.html')));
assert.ok(!files.some(file => /(^|[\\/])(data|node_modules|\.tmp|qweather-user\.json|deskisland\.json)([\\/]|$)/i.test(file)), 'Personal data must not enter the installer');
assert.ok(!(await fs.readFile(path.join(appDirectory, 'dist', 'renderer', 'index.html'), 'utf8')).includes('src="/assets/'), 'Renderer assets must use relative paths');
await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify({ version: packageJson.version, files: files.sort() }, null, 2));
const installer = path.join(root, 'dist', `DeskIsland-${packageJson.version}-Setup.exe`);
await fs.rm(installer, { force: true });
await fs.writeFile(path.join(temp, 'version.iss'), `#define AppVersion "${packageJson.version}"\n`);
const compilerArgs = [path.join(root, 'installer', 'setup.iss')];
await run(compiler, path.basename(compiler).toLowerCase() === 'iside.exe' ? ['-cc', ...compilerArgs] : compilerArgs);
const bytes = await fs.readFile(installer);
const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
await fs.writeFile(`${installer}.sha256`, `${hash}  ${path.basename(installer)}\n`);
console.log(`Installer: ${installer}\nBytes: ${bytes.length}\nSHA-256: ${hash}`);
