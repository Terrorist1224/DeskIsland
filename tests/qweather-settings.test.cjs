const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createCipheriv, createDecipheriv } = require('node:crypto');
const { QWeatherSettings } = require('../src/main/qweather-settings.cjs');
const encryptionKey = Buffer.alloc(32, 1), iv = Buffer.alloc(16, 2);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: value => { const cipher = createCipheriv('aes-256-cbc', encryptionKey, iv); return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); },
  decryptString: value => { const cipher = createDecipheriv('aes-256-cbc', encryptionKey, iv); return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8'); },
};
function profile(t) {
  const directory = path.resolve('.tmp', 'qweather-settings-tests', randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('personal credentials persist encrypted, reload and never appear in status', t => {
  const directory = profile(t), settings = new QWeatherSettings(directory, storage);
  assert.equal(settings.status().configured, false);
  const config = { host: 'test.qweatherapi.com', apiKey: 'TEST_ONLY_PERSONAL_KEY' };
  settings.save(config);
  const saved = fs.readFileSync(settings.filePath, 'utf8');
  assert.equal(saved.includes(config.apiKey), false);
  assert.equal(JSON.stringify(settings.status()).includes(config.apiKey), false);
  const loaded = new QWeatherSettings(directory, storage);
  assert.equal(loaded.service.config.apiKey, config.apiKey);
  assert.equal(loaded.status().mode, 'apiKey');
  assert.throws(() => loaded.save({ ...config, host: 'evil.example' }), /配置/);
  assert.equal(fs.readFileSync(settings.filePath, 'utf8'), saved);
});

test('corrupt credentials are preserved and never silently replaced or shared', t => {
  const directory = profile(t), file = path.join(directory, 'qweather-user.json');
  fs.writeFileSync(file, 'invalid test data');
  const settings = new QWeatherSettings(directory, storage);
  assert.equal(settings.status().configured, false);
  assert.match(settings.status().error, /原文件已保留/);
  assert.throws(() => settings.save({ host: 'test.qweatherapi.com', apiKey: 'TEST_ONLY_KEY' }), /原文件已保留/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'invalid test data');
});

test('missing OS encryption refuses to save secrets', t => {
  const settings = new QWeatherSettings(profile(t), { isEncryptionAvailable: () => false });
  assert.throws(() => settings.save({ host: 'test.qweatherapi.com', apiKey: 'TEST_ONLY_KEY' }), /未保存/);
  assert.equal(fs.existsSync(settings.filePath), false);
});

test('old JWT config is ignored and JWT-only service config is rejected', t => {
  const directory = profile(t);
  fs.writeFileSync(path.join(directory, 'qweather.json'), JSON.stringify({ host: 'test.qweatherapi.com', privateKeyPath: 'test-private.pem' }));
  assert.equal(new QWeatherSettings(directory, storage).status().configured, false);
  const { QWeatherService } = require('../src/main/qweather-service.cjs');
  assert.throws(() => new QWeatherService({ host: 'test.qweatherapi.com', developerId: 'Q123456789', projectId: 'ABCDEFGHIJ', credentialId: '1234567890' }), /配置/);
});
