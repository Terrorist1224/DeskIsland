const fs = require('node:fs');
const path = require('node:path');
const { QWeatherService } = require('./qweather-service.cjs');

class QWeatherSettings {
  constructor(userDataPath, safeStorage) {
    this.filePath = path.join(userDataPath, 'qweather-user.json');
    this.safeStorage = safeStorage;
    this.service = null;
    this.error = '';
    if (fs.existsSync(this.filePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (typeof saved.encryptedKey !== 'string' || !safeStorage.isEncryptionAvailable()) throw new Error();
        this.service = new QWeatherService({ host: saved.host, apiKey: safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64')) });
      } catch {
        this.service = null;
        this.error = '个人天气凭据无法读取，原文件已保留，请检查本机配置';
      }
    }
  }

  status() {
    return { configured: Boolean(this.service), host: this.service?.config.host ?? '',
      mode: this.service ? 'apiKey' : 'none', error: this.error };
  }

  save(config) {
    if (this.error) throw new Error(this.error);
    if (!config || typeof config.host !== 'string' || typeof config.apiKey !== 'string') throw new TypeError('请输入 API Host 和 API KEY');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，未保存凭据');
    const service = new QWeatherService({ host: config.host.trim(), apiKey: config.apiKey.trim() });
    const saved = { host: service.config.host, encryptedKey: this.safeStorage.encryptString(service.config.apiKey).toString('base64') };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(saved, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
    this.service = service;
  }
}

module.exports = { QWeatherSettings };
