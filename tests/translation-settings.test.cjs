const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createCipheriv, createDecipheriv } = require('node:crypto');
const { TranslationSettings, validateConfig } = require('../src/main/translation-settings.cjs');
const { defaultPrompt, maxPrompt } = require('../src/shared/translation-catalog.json');
const config = { apiKey: 'TEST_ONLY_SECRET', baseUrl: 'https://example.invalid/v1', model: 'test-only-model', prompt: 'TEST_ONLY_CUSTOM_PROMPT\n测试专用提示词' };
const key = Buffer.alloc(32, 3), iv = Buffer.alloc(16, 4);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString(value) { const cipher = createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); },
  decryptString(value) { const cipher = createDecipheriv('aes-256-cbc', key, iv); return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8'); },
};
function profile(t) { const directory = path.resolve('.tmp', 'translation-settings-tests', randomUUID()); fs.mkdirSync(directory, { recursive: true }); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
test('all credentials stay encrypted at rest, the control status exposes the full key, and preferences reload without text', t => {
  const directory = profile(t), settings = new TranslationSettings(directory, storage);
  settings.save('ai', config);
  settings.savePreferences({ provider: 'ai', target: 'fr' });
  const saved = fs.readFileSync(settings.filePath, 'utf8'); assert.equal(saved.includes(config.apiKey), false); assert.equal(saved.includes(config.prompt), false);
  const restored = new TranslationSettings(directory, storage); assert.equal(restored.configs.ai.apiKey, config.apiKey); assert.equal(restored.preferences.target, 'fr'); assert.equal(restored.status().providers.ai.configured, true); assert.equal(saved.includes('text'), false);
  assert.equal(restored.status().providers.ai.prompt, config.prompt); assert.equal(restored.status().providers.ai.hasApiKey, true); assert.equal(restored.status().providers.ai.apiKey, config.apiKey); assert.equal(restored.status().providers.ai.reasoningEffort, '');
});
test('AI URL policy accepts only HTTPS remote or loopback HTTP, and rejects URL secrets', () => {
  for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:8000/v1/', 'http://[::1]:8000/v1']) assert.equal(validateConfig('ai', { baseUrl, model: 'test', apiKey: '' }).apiKey, '');
  for (const baseUrl of ['http://example.com/v1', 'http://localhost.example.com', 'file:///test', 'https://user:pass@example.com', 'https://example.com/?key=secret', 'https://example.com/#test']) assert.throws(() => validateConfig('ai', { baseUrl, model: 'test', apiKey: 'TEST_ONLY' }));
  assert.throws(() => validateConfig('ai', { baseUrl: 'https://example.com/v1', model: 'test', apiKey: '' }));
  assert.throws(() => validateConfig('ai', { ...config, apiKey: 'TEST\nINJECT' }));
  for (const provider of ['google', 'youdao', 'microsoft']) assert.throws(() => validateConfig(provider, config));
  for (const prompt of [123, null, '', '  ', 'a'.repeat(maxPrompt + 1), 'bad\0prompt']) assert.throws(() => validateConfig('ai', { ...config, prompt }));
  for (const reasoningEffort of ['auto', 'ultra-max', 'HIGH']) assert.throws(() => validateConfig('ai', { ...config, reasoningEffort }));
  assert.equal(validateConfig('ai', config).reasoningEffort, '');
  assert.equal(validateConfig('ai', { ...config, reasoningEffort: 'ultra' }).reasoningEffort, 'ultra');
  assert.equal(validateConfig('ai', { ...config, prompt: 'a'.repeat(maxPrompt) }).prompt.length, maxPrompt);
});
test('unavailable encryption, corrupt files and failed writes never overwrite prior credentials', t => {
  const directory = profile(t), settings = new TranslationSettings(directory, storage);
  settings.save('ai', { ...config, apiKey: 'TEST_ONLY_OLD' });
  const before = fs.readFileSync(settings.filePath, 'utf8'), rename = fs.renameSync;
  fs.renameSync = () => { throw Error('TEST_ONLY_DISK_FAILURE'); };
  try { assert.throws(() => settings.save('ai', { ...config, apiKey: 'TEST_ONLY_NEW' })); assert.equal(settings.configs.ai.apiKey, 'TEST_ONLY_OLD'); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(settings.filePath, 'utf8'), before);
  const locked = new TranslationSettings(directory, { ...storage, isEncryptionAvailable: () => false }); assert.match(locked.error, /原文件已保留/); assert.throws(() => locked.save('ai', { ...config, apiKey: 'TEST_ONLY_NEW' })); assert.throws(() => locked.connection(config)); assert.equal(fs.readFileSync(settings.filePath, 'utf8'), before);
  fs.writeFileSync(settings.filePath, '{TEST_ONLY_CORRUPT'); const corrupt = new TranslationSettings(directory, storage); assert.throws(() => corrupt.savePreferences({ provider: 'ai', target: 'auto' })); assert.equal(fs.readFileSync(settings.filePath, 'utf8'), '{TEST_ONLY_CORRUPT');
});

test('legacy machine preferences migrate to AI without losing language or existing AI config', t => {
  for (const provider of ['youdao', 'google', 'microsoft']) {
    const directory = profile(t), file = path.join(directory, 'translation-user.json');
    const oldAI = { ...config }; delete oldAI.prompt;
    const encrypted = value => ({ encrypted: storage.encryptString(JSON.stringify(value)).toString('base64') });
    const saved = JSON.stringify({ version: 1, preferences: { provider, target: 'auto', chineseTarget: 'ja' }, configs: { [provider]: encrypted({ apiKey: 'TEST_ONLY_LEGACY' }), ai: encrypted(oldAI) } });
    fs.writeFileSync(file, saved);
    const settings = new TranslationSettings(directory, storage);
    assert.equal(settings.error, ''); assert.equal(settings.preferences.provider, 'ai'); assert.equal(settings.preferences.target, 'auto'); assert.equal('chineseTarget' in settings.preferences, false);
    assert.deepEqual(settings.configs.ai, { ...oldAI, prompt: defaultPrompt, reasoningEffort: '' }); assert.deepEqual(Object.keys(settings.status().providers), ['ai']);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    settings.save('ai', { ...config, apiKey: '' });
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).configs), ['ai']);
  }
});

test('legacy-only configuration opens unconfigured AI and keeps the original file until a write', t => {
  const directory = profile(t), file = path.join(directory, 'translation-user.json');
  const saved = JSON.stringify({ version: 1, preferences: { provider: 'google', target: 'fr' }, configs: { google: { encrypted: 'TEST_ONLY_UNUSED_OLD_DATA' } } });
  fs.writeFileSync(file, saved);
  const settings = new TranslationSettings(directory, storage);
  assert.equal(settings.error, ''); assert.equal(settings.preferences.target, 'fr'); assert.equal(settings.status().providers.ai.configured, false);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
});

test('v1 extra prompts become one visible template and v2 reload never adds hidden defaults', t => {
  for (const extra of ['', config.prompt, 'a'.repeat(4000)]) {
    const directory = profile(t), file = path.join(directory, 'translation-user.json');
    const old = { ...config, prompt: extra };
    const original = JSON.stringify({ version: 1, preferences: { provider: 'ai', target: 'auto' }, configs: { ai: { encrypted: storage.encryptString(JSON.stringify(old)).toString('base64') } } });
    fs.writeFileSync(file, original);
    const migrated = new TranslationSettings(directory, storage);
    assert.equal(migrated.error, '');
    const expected = defaultPrompt + (extra ? '\n\n' + extra : '');
    assert.equal(migrated.status().providers.ai.prompt, expected);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    migrated.save('ai', { ...config, prompt: expected });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
    const restored = new TranslationSettings(directory, storage);
    assert.equal(restored.configs.ai.prompt, expected);
    restored.save('ai', { ...config, prompt: 'TEST_ONLY_REPLACEMENT {{targetLanguage}}' });
    assert.equal(new TranslationSettings(directory, storage).configs.ai.prompt, 'TEST_ONLY_REPLACEMENT {{targetLanguage}}');
  }
});

test('stored API key is reused only for the same URL, including model retrieval before selecting a model', t => {
  const settings = new TranslationSettings(profile(t), storage);
  settings.save('ai', config);
  assert.deepEqual(settings.connection({ baseUrl: config.baseUrl + '/', apiKey: '' }), { baseUrl: config.baseUrl, apiKey: config.apiKey });
  settings.save('ai', { ...config, apiKey: '', model: 'test-other', prompt: 'TEST_ONLY_UPDATED' });
  assert.equal(settings.configs.ai.apiKey, config.apiKey); assert.equal(settings.configs.ai.model, 'test-other');
  settings.save('ai', { ...config, apiKey: '', reasoningEffort: 'max' });
  assert.equal(settings.configs.ai.reasoningEffort, 'max');
  assert.equal(new TranslationSettings(path.dirname(settings.filePath), storage).configs.ai.reasoningEffort, 'max');
  for (const baseUrl of ['https://other.invalid/v1', 'https://example.invalid/other']) {
    assert.throws(() => settings.connection({ baseUrl, apiKey: '' }));
    assert.throws(() => settings.save('ai', { ...config, baseUrl, apiKey: '' }));
  }
  assert.deepEqual(settings.connection({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }), { baseUrl: 'http://localhost:11434/v1', apiKey: '' });
});
