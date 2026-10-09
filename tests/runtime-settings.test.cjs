const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configureDataPaths, getStartupSettings, setStartupSettings } = require('../src/main/runtime-settings.cjs');

test('development data paths and child-process temporary directories stay inside workspace', t => {
  const root = path.resolve('.tmp/tests/runtime-settings');
  const savedTemp = process.env.TEMP, savedTmp = process.env.TMP;
  t.after(() => { process.env.TEMP = savedTemp; process.env.TMP = savedTmp; });
  const paths = {};
  const app = { isPackaged: false, getAppPath: () => root, setPath: (key, value) => { paths[key] = value; }, setAppLogsPath: value => { paths.logs = value; } };
  const data = configureDataPaths(app);
  assert.equal(data, path.join(root, '.tmp/user-data'));
  for (const [key, directory] of Object.entries(paths)) {
    assert.ok(directory === data || directory.startsWith(data + path.sep), key);
    if (key !== 'logs') assert.ok(fs.statSync(directory).isDirectory());
  }
  assert.equal(process.env.TEMP, paths.temp);
  assert.equal(process.env.TMP, paths.temp);
});

test('unwritable or invalid data directory fails without falling back', () => {
  const root = path.resolve('.tmp/tests/runtime-unwritable');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, '.tmp'), 'test file blocks directory creation');
  let calls = 0;
  assert.throws(() => configureDataPaths({ isPackaged: false, getAppPath: () => root, setPath: () => calls++ }));
  assert.equal(calls, 0);
});

function startupApp() {
  let enabled = false, approved = true, lastSettings;
  const app = { isPackaged: true,
    getLoginItemSettings(options) {
      assert.deepEqual(options, { path: process.execPath, args: ['--autostart'] });
      return { openAtLogin: enabled, launchItems: enabled ? [{ name: 'DeskIsland', scope: 'user', enabled: approved }] : [] };
    },
    setLoginItemSettings(settings) { lastSettings = settings; enabled = settings.openAtLogin; approved = settings.enabled; },
  };
  return { app, disableInWindows: () => { approved = false; }, last: () => lastSettings };
}

test('startup enable/disable uses matching executable and arguments and honors Windows disable', () => {
  const { app, disableInWindows, last } = startupApp();
  assert.deepEqual(getStartupSettings(app), { supported: true, enabled: false });
  assert.equal(setStartupSettings(app, true).enabled, true);
  assert.equal(last().name, 'DeskIsland');
  assert.equal(last().path, process.execPath);
  assert.deepEqual(last().args, ['--autostart']);
  disableInWindows();
  assert.equal(getStartupSettings(app).enabled, false);
  assert.equal(setStartupSettings(app, true).enabled, true);
  assert.equal(setStartupSettings(app, false).enabled, false);
  assert.throws(() => setStartupSettings(app, 'true'), /布尔/);
});

test('development and test mode never write startup entries; rejected writes are reported', t => {
  let writes = 0;
  const app = { isPackaged: false, setLoginItemSettings: () => writes++ };
  assert.throws(() => setStartupSettings(app, true), /测试模式/);
  const previous = process.env.DESKISLAND_TEST_MODE;
  t.after(() => { if (previous === undefined) delete process.env.DESKISLAND_TEST_MODE; else process.env.DESKISLAND_TEST_MODE = previous; });
  process.env.DESKISLAND_TEST_MODE = '1';
  app.isPackaged = true;
  assert.throws(() => setStartupSettings(app, true), /测试模式/);
  assert.equal(writes, 0);
  delete process.env.DESKISLAND_TEST_MODE;
  const denied = startupApp().app;
  denied.setLoginItemSettings = () => {};
  assert.throws(() => setStartupSettings(denied, true), /未生效/);
});
