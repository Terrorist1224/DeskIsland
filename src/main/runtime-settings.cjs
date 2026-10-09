const fs = require('node:fs');
const path = require('node:path');

const startupName = 'DeskIsland';
const startupArgs = ['--autostart'];

function configureDataPaths(app) {
  const root = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'data')
    : path.join(app.getAppPath(), '.tmp', 'user-data');
  // These paths must exist and be set before Electron creates its first session.
  for (const [name, directory] of Object.entries({ userData: root, sessionData: path.join(root, 'session'), temp: path.join(root, 'temp'), crashDumps: path.join(root, 'crashes') })) {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.W_OK);
    app.setPath(name, directory);
  }
  const probe = path.join(root, `.write-check-${process.pid}`);
  fs.writeFileSync(probe, '');
  fs.unlinkSync(probe);
  app.setAppLogsPath(path.join(root, 'logs'));
  process.env.TEMP = process.env.TMP = path.join(root, 'temp');
  return root;
}

function getStartupSettings(app) {
  const supported = app.isPackaged && process.env.DESKISLAND_TEST_MODE !== '1';
  if (!supported) return { supported: false, enabled: false };
  const state = app.getLoginItemSettings({ path: process.execPath, args: startupArgs });
  const entry = state.launchItems.find(item => item.name === startupName && item.scope === 'user');
  return { supported: true, enabled: state.openAtLogin && Boolean(entry?.enabled) };
}

function setStartupSettings(app, enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('开机自启状态必须是布尔值');
  if (!getStartupSettings(app).supported) throw new Error('开发测试模式不支持设置开机自启，请使用安装后的桌屿');
  app.setLoginItemSettings({ name: startupName, path: process.execPath, args: startupArgs, openAtLogin: enabled, enabled });
  const state = getStartupSettings(app);
  if (state.enabled !== enabled) throw new Error('开机自启设置未生效，请检查 Windows 启动应用设置');
  return state;
}

module.exports = { configureDataPaths, getStartupSettings, setStartupSettings };
