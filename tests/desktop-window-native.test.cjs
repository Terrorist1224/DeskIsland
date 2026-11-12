const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('native desktop repair and session click hooks preserve focus, hit-test actual windows and release threads', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'desktop-window-native-check.ps1')], {
    windowsHide: true, encoding: 'utf8', timeout: 20000,
  });
  assert.match(output,/DESKTOP_WINDOW_NATIVE_PASSED/);
});
