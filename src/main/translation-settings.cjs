const fs = require('node:fs');
const path = require('node:path');
const { providers, validatePreferences } = require('../shared/translation.cjs');
const { defaultPrompt, maxPrompt, reasoningEfforts } = require('../shared/translation-catalog.json');

function configString(input, key) {
  if (typeof input?.[key] !== 'string' || input[key].length > 4096 || /[\r\n\0]/.test(input[key])) throw new TypeError('翻译服务配置无效');
  return input[key].trim();
}
function validateConnection(input, saved) {
  const baseUrl = configString(input, 'baseUrl');
  let apiKey = configString(input, 'apiKey'), url;
  try { url = new URL(baseUrl); } catch { throw new TypeError('请输入有效的 AI Base URL'); }
  const normalized = url.href.replace(/\/+$/, '');
  // Reuse the stored key only for the exact saved endpoint, never for a changed URL.
  if (!apiKey && normalized === saved?.baseUrl) apiKey = saved.apiKey;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || (!apiKey && !local)) throw new TypeError('远程 AI 需要 HTTPS 和密钥；仅本机回环地址允许 HTTP 和空密钥');
  return { apiKey, baseUrl: normalized };
}
function validateConfig(provider, input, saved) {
  if (!providers.includes(provider)) throw new TypeError('翻译服务配置无效');
  const connection = validateConnection(input, saved), model = configString(input, 'model');
  const prompt = input.prompt === undefined ? defaultPrompt : input.prompt;
  const reasoningEffort = input.reasoningEffort === undefined || input.reasoningEffort === '' ? '' : configString(input, 'reasoningEffort');
  if (!model) throw new TypeError('请填写或选择模型 ID');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > maxPrompt || prompt.includes('\0')) throw new TypeError(`请输入提示词或恢复默认模板，最多 ${maxPrompt} 个字符`);
  if (reasoningEffort && !reasoningEfforts.includes(reasoningEffort)) throw new TypeError('思考强度无效');
  return { ...connection, model, prompt: prompt.trim(), reasoningEffort };
}

class TranslationSettings {
  constructor(userDataPath, safeStorage) {
    this.filePath = path.join(userDataPath, 'translation-user.json');
    this.storage = safeStorage;
    this.preferences = { provider: 'ai', target: 'auto' };
    this.configs = {};
    this.error = '';
    if (!fs.existsSync(this.filePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (![1, 2].includes(saved.version) || !saved.configs || typeof saved.configs !== 'object' || Array.isArray(saved.configs)) throw new Error();
      // Read v1 machine-translation preferences without rewriting the user's file on startup.
      const legacy = ['youdao', 'google', 'microsoft'].includes(saved.preferences?.provider);
      this.preferences = validatePreferences(legacy ? { ...saved.preferences, provider: 'ai' } : saved.preferences);
      const configs = {};
      for (const [provider, value] of Object.entries(saved.configs)) {
        if (['youdao', 'google', 'microsoft'].includes(provider)) continue;
        if (!this.storage.isEncryptionAvailable() || typeof value.encrypted !== 'string') throw new Error();
        const config = JSON.parse(this.storage.decryptString(Buffer.from(value.encrypted, 'base64')));
        // v1 stored only extra requirements; expose the entire effective prompt once, then save as v2.
        if (saved.version === 1) {
          if (config.prompt !== undefined && (typeof config.prompt !== 'string' || config.prompt.length > 4000)) throw new Error();
          config.prompt = defaultPrompt + (config.prompt?.trim() ? `\n\n${config.prompt.trim()}` : '');
        }
        configs[provider] = validateConfig(provider, config);
      }
      this.configs = configs;
    } catch {
      this.configs = {};
      this.error = '翻译配置无法读取，原文件已保留，请检查本机配置';
    }
  }
  status() {
    return { preferences: { ...this.preferences }, error: this.error, providers: Object.fromEntries(providers.map(provider => {
      const config = this.configs[provider];
      return [provider, { configured: Boolean(config), hasApiKey: Boolean(config?.apiKey), apiKey: config?.apiKey ?? '', baseUrl: config?.baseUrl ?? '', model: config?.model ?? '', prompt: config?.prompt ?? defaultPrompt, reasoningEffort: config?.reasoningEffort ?? '' }];
    })) };
  }
  save(provider, input) {
    const config = validateConfig(provider, input, this.configs.ai);
    this.write(this.preferences, { ...this.configs, [provider]: config });
    return this.status();
  }
  connection(input) {
    if (this.error) throw new Error(this.error);
    return validateConnection(input, this.configs.ai);
  }
  savePreferences(input) {
    if (this.error) throw new Error(this.error);
    const preferences = validatePreferences(input);
    if (JSON.stringify(preferences) !== JSON.stringify(this.preferences)) this.write(preferences, this.configs);
  }
  write(preferences, configs) {
    if (this.error) throw new Error(this.error);
    if (Object.keys(configs).length && !this.storage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，未保存翻译凭据');
    const saved = { version: 2, preferences, configs: Object.fromEntries(Object.entries(configs).map(([provider, config]) => [provider, { encrypted: this.storage.encryptString(JSON.stringify(config)).toString('base64') }])) };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(`${this.filePath}.tmp`, JSON.stringify(saved, null, 2), 'utf8');
    fs.renameSync(`${this.filePath}.tmp`, this.filePath);
    this.preferences = { ...preferences };
    this.configs = configs;
  }
}
module.exports = { TranslationSettings, validateConfig };
