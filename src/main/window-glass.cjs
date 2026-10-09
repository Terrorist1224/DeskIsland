const os = require('node:os');

const supportsNativeAcrylic = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;

function getWindowHandle(window) {
  const handle = window.getNativeWindowHandle();
  return (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
}

function installLegacyGlass(window, getWindowsHost, blur = true) {
  if (supportsNativeAcrylic || process.platform !== 'win32') return;
  let resizeTimer;
  function apply() {
    if (window.isDestroyed() || window.isMinimized()) return;
    // Win10 accent blur has no adjustable radius; renderer tint controls darkness independently.
    void getWindowsHost().request('system.window-glass', { handle: getWindowHandle(window), blur }).catch(error => {
      if (window.isDestroyed()) return;
      console.error('Desktop blur is unavailable:', error);
      window.setBackgroundColor(blur ? '#17161b' : '#00000000');
    });
  }
  window.once('ready-to-show', apply);
  window.on('restore', apply);
  window.on('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(apply, 100); });
  window.once('closed', () => clearTimeout(resizeTimer));
}

module.exports = { supportsNativeAcrylic, getWindowHandle, installLegacyGlass };
