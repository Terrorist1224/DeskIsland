const catalog = require('./translation-catalog.json');
const providers = catalog.providers.map(item => item.id);
const languages = catalog.languages;
const MAX_TEXT = catalog.maxText;
function validatePreferences(value) {
  if (!value || !providers.includes(value.provider) ||
      (value.target !== 'auto' && !languages.some(item => item.id === value.target))) throw new TypeError('翻译偏好无效');
  return { provider: value.provider, target: value.target };
}
function validateText(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new TypeError(`每次最多翻译 ${MAX_TEXT} 个字符`);
  return text;
}
function resolveTarget(text, target) {
  if (target !== 'auto') return target;
  // Han-only text is indistinguishable from Kanji-only Japanese here; follow the Chinese-first rule.
  return /\p{Script=Han}/u.test(text) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
    ? 'en' : 'zh-CN';
}
module.exports = { providers, languages, MAX_TEXT, validatePreferences, validateText, resolveTarget };
