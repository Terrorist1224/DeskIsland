const { languages, validatePreferences, validateText, resolveTarget } = require('../shared/translation.cjs');
const { defaultPrompt } = require('../shared/translation-catalog.json');

function translationPrompt(target, template = defaultPrompt) {
  const name = languages.find(item => item.id === target)?.name;
  if (!name) throw new TypeError('目标语言无效');
  return template.replaceAll('{{targetLanguage}}', name);
}
async function requestJson(url, options, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, { ...options, redirect: 'error' }); }
  catch { throw new Error('无法连接翻译服务，请检查网络或服务地址'); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('翻译凭据或权限无效，请检查个人配置');
    if (response.status === 429) throw new Error('翻译额度或调用频率受限，请稍后重试');
    throw new Error(`翻译服务暂不可用（${response.status}）`);
  }
  try { return await response.json(); } catch { throw new Error('翻译服务返回的数据格式无效'); }
}
async function translateText(provider, config, text, target, { fetchImpl = fetch, signal } = {}) {
  if (provider !== 'ai') throw new TypeError('翻译服务无效');
  const data = await requestJson(`${config.baseUrl}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, stream: false, ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}), messages: [{ role: 'system', content: translationPrompt(target, config.prompt) }, { role: 'user', content: text }] }),
  }, fetchImpl);
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('AI 译文达到服务输出限制，请缩短原文或调整服务配置');
  if (choice?.finish_reason === 'content_filter') throw new Error('AI 服务未能输出译文，请检查服务策略');
  const result = choice?.message?.content;
  if (typeof result !== 'string' || !result.trim() || result.length > 100000) throw new Error('翻译服务未返回有效译文');
  return result;
}

class TranslationService {
  constructor(settings, { fetchImpl = fetch, timeoutMs, modelsTimeoutMs = 15000 } = {}) {
    this.settings = settings;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.modelsTimeoutMs = modelsTimeoutMs;
    this.state = { ...settings.preferences, text: '', result: '', error: '', revision: 0, status: 'idle' };
    this.controller = null;
  }
  snapshot() { return { ...this.state }; }
  async listModels(input) {
    const config = this.settings.connection(input), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.modelsTimeoutMs);
    try {
      const data = await requestJson(`${config.baseUrl}/models`, {
        method: 'GET', signal: controller.signal,
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      }, this.fetchImpl);
      if (controller.signal.aborted) throw new Error('获取模型超时');
      if (!Array.isArray(data?.data) || data.data.length > 10000 || data.data.some(item => typeof item?.id !== 'string' || !item.id.trim() || item.id.length > 4096 || /[\r\n\0]/.test(item.id))) throw new Error('服务未返回有效的模型列表');
      const models = [...new Set(data.data.map(item => item.id.trim()))].sort();
      if (!models.length) throw new Error('服务未返回可选模型');
      return models;
    } catch (error) {
      throw new Error(`${controller.signal.aborted ? '获取模型超时' : error.message}，可手动填写模型 ID`);
    } finally { clearTimeout(timer); }
  }
  cancel() {
    this.controller?.abort();
    this.controller = null;
    this.state.revision++;
    if (this.state.status === 'loading') this.state.status = 'idle';
    return this.snapshot();
  }
  update(input) {
    if (!input || typeof input !== 'object') throw new TypeError('翻译输入无效');
    this.cancel();
    if (typeof input.text !== 'string' || input.text.length > 1000000) throw new TypeError('翻译输入无效或过长');
    const preferences = validatePreferences({ provider: input.provider, target: input.target });
    this.state.text = input.text;
    this.state.result = '';
    this.state.error = '';
    try { this.settings.savePreferences(preferences); }
    catch { this.state.status = 'error'; this.state.error = this.settings.error || '翻译偏好保存失败，请重试'; return this.snapshot(); }
    Object.assign(this.state, preferences);
    try { validateText(input.text); }
    catch (error) { this.state.status = 'error'; this.state.error = error.message; return this.snapshot(); }
    this.state.status = 'idle';
    return this.snapshot();
  }
  async translate(revision) {
    if (!Number.isSafeInteger(revision) || revision !== this.state.revision || this.controller) return this.snapshot();
    const { text, provider, target } = this.state;
    if (!text.trim() || this.state.status === 'error') return this.snapshot();
    const to = resolveTarget(text, target);
    const config = this.settings.configs[provider];
    if (!config || this.settings.error) {
      this.state.status = 'error'; this.state.error = this.settings.error || '请在主控的「翻译」页面配置所选服务';
      return this.snapshot();
    }
    const controller = new AbortController();
    this.controller = controller;
    this.state.status = 'loading';
    let timedOut = false;
    // Abort only stops local waiting; providers may already have accepted a billable request.
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs ?? 60000);
    try {
      const result = await translateText(provider, config, text, to, { fetchImpl: this.fetchImpl, signal: controller.signal });
      if (revision === this.state.revision) {
        if (timedOut) { this.state.status = 'error'; this.state.error = '翻译请求超时，请重试'; }
        else if (!controller.signal.aborted) { this.state.result = result; this.state.status = 'done'; }
      }
    } catch (error) {
      if (revision === this.state.revision) { this.state.error = timedOut ? '翻译请求超时，请重试' : error.message; this.state.status = 'error'; }
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
    return this.snapshot();
  }
}
module.exports = { TranslationService, translateText, translationPrompt };
