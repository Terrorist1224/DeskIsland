function validateDuration(seconds, allowZero = false) {
  if (!Number.isInteger(seconds) || seconds < (allowZero ? 0 : 1) || seconds > 86400) throw new TypeError('倒计时时长须在 1 秒至 24 小时之间');
  return seconds;
}
function validateSettings(settings) {
  validateDuration(settings.seconds, true);
  if (!Array.isArray(settings.presets)) throw new TypeError('Invalid countdown presets');
  const ids = new Set();
  for (const preset of settings.presets) {
    if (typeof preset.id !== 'string' || !preset.id || preset.id.length > 64 || ids.has(preset.id)) throw new TypeError('Invalid countdown preset id');
    ids.add(preset.id);
    if (typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 40) throw new TypeError('预设名称须为 1–40 个字符');
    validateDuration(preset.seconds);
  }
}
module.exports = { validateDuration, validateSettings };
