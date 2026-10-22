const test = require('node:test');
const assert = require('node:assert/strict');
const { TranslationService, translateText, translationPrompt } = require('../src/main/translation-service.cjs');
const { resolveTarget, validateText, validatePreferences, languages } = require('../src/shared/translation.cjs');
const { defaultPrompt } = require('../src/shared/translation-catalog.json');
const config = { apiKey: 'TEST_ONLY_KEY', baseUrl: 'https://example.invalid/v1', model: 'test-only-model', prompt: defaultPrompt + '\nTEST_ONLY_CUSTOM_PROMPT\n第二行测试要求' };
const response = data => ({ ok: true, json: async () => data });
function harness(fetchImpl, timeoutMs) {
  const settings = { preferences: { provider: 'ai', target: 'auto' }, configs: { ai: config }, error: '', savePreferences(value) { this.preferences = value; }, connection: input => input };
  return new TranslationService(settings, { fetchImpl, timeoutMs });
}
test('auto target sends Chinese to English and other scripts to Simplified Chinese', () => {
  for (const text of ['Hello', 'bonjour', 'Привет', '日本語です', 'こんにちは', '한국어 漢字']) assert.equal(resolveTarget(text, 'auto'), 'zh-CN');
  // Han-only Japanese is inherently ambiguous and follows the Chinese-first rule.
  for (const text of ['你好', '繁體中文', 'Hello 世界', '日本語']) assert.equal(resolveTarget(text, 'auto'), 'en');
  assert.equal(resolveTarget('Hello', 'fr'), 'fr'); assert.equal(resolveTarget('Hello', 'lzh'), 'lzh');
  assert.equal(languages.length, 10); assert.ok(languages.some(item => item.id === 'lzh' && item.name === '文言文'));
  assert.equal(validateText('a'.repeat(5000)).length, 5000);
  assert.throws(() => validateText('a'.repeat(5001)));
  assert.throws(() => validatePreferences({ provider: 'unknown', target: 'en' }));
});
test('AI requests inject custom requirements, isolate source and preserve all target languages', async () => {
  for (const language of languages) {
    const fetchImpl = async (url, options) => {
      assert.equal(url, 'https://example.invalid/v1/chat/completions');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer ' + config.apiKey);
      const body = JSON.parse(options.body);
      assert.equal(body.model, config.model); assert.equal(body.stream, false); assert.equal('reasoning_effort' in body, false);
      assert.equal(body.messages.length, 2); assert.equal(body.messages[1].content, 'TEST_ONLY_TEXT');
      assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user');
      assert.ok(body.messages[0].content.includes(language.name));
      assert.equal(body.messages[0].content, config.prompt.replaceAll('{{targetLanguage}}', language.name));
      return response({ choices: [{ message: { content: '测试译文' } }] });
    };
    assert.equal(await translateText('ai', config, 'TEST_ONLY_TEXT', language.id, { fetchImpl }), '测试译文');
  }
  await translateText('ai', { ...config, apiKey: '', prompt: 'TEST_ONLY_FULL_TEMPLATE {{targetLanguage}} {{targetLanguage}}' }, 'test', 'en', { fetchImpl: async (_url, options) => {
    assert.equal('Authorization' in options.headers, false); assert.equal(JSON.parse(options.body).messages[0].content, 'TEST_ONLY_FULL_TEMPLATE 英语 英语');
    return response({ choices: [{ message: { content: 'test' } }] });
  } });
  for (const provider of ['google', 'youdao', 'microsoft']) await assert.rejects(translateText(provider, config, 'text', 'en'), /服务无效/);
  assert.throws(() => translationPrompt('invalid'));
  assert.equal(translationPrompt('en', 'TEST_ONLY_WITHOUT_LANGUAGE_TOKEN'), 'TEST_ONLY_WITHOUT_LANGUAGE_TOKEN');
  await translateText('ai', { ...config, reasoningEffort: 'high' }, 'test', 'en', { fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).reasoning_effort, 'high');
    return response({ choices: [{ message: { content: 'test' } }] });
  } });
});

test('provider failures are sanitized, never leak server data, and never retry', async () => {
  for (const finish_reason of ['length', 'content_filter']) await assert.rejects(translateText('ai', config, 'text', 'en', { fetchImpl: async () => response({ choices: [{ finish_reason, message: { content: 'PARTIAL_TEST_ONLY' } }] }) }), /输出限制|服务策略/);
  for (const status of [401, 403, 429, 503]) await assert.rejects(translateText('ai', config, 'text', 'en', { fetchImpl: async () => ({ ok: false, status }) }), /凭据|额度|暂不可用/);
  await assert.rejects(translateText('ai', config, 'text', 'en', { fetchImpl: async () => { throw Error('TEST_ONLY_SECRET_TEXT'); } }), error => !error.message.includes('SECRET'));
  for (const data of [{}, { data: { translations: [{ translatedText: '' }] } }]) await assert.rejects(translateText('ai', config, 'text', 'en', { fetchImpl: async () => response(data) }), /有效译文/);
  await assert.rejects(translateText('ai', config, 'text', 'en', { fetchImpl: async () => ({ ok: true, json: async () => { throw Error('TEST_ONLY_SECRET'); } }) }), /数据格式无效/);
});
test('auto target translates immediately, preserves oversize text, persists only preferences', async () => {
  let calls = 0; const prompts = [];
  const service = harness(async (_url, options) => { calls++; prompts.push(JSON.parse(options.body).messages[0].content); return response({ choices: [{ message: { content: 'test' } }] }); });
  let state = service.update({ text: '测试', provider: 'ai', target: 'auto' });
  assert.equal(state.status, 'idle'); await service.translate(state.revision); assert.equal(calls, 1);
  state = service.update({ text: 'Hello', provider: 'ai', target: 'auto' }); assert.equal(state.status, 'idle');
  await service.translate(state.revision); assert.equal(calls, 2);
  assert.match(prompts[0], /英语/); assert.match(prompts[1], /简体中文/);
  state = service.update({ text: 'a'.repeat(5001), provider: 'ai', target: 'auto' }); assert.equal(state.text.length, 5001); assert.equal(state.status, 'error');
  await service.translate(state.revision); assert.equal(calls, 2);
  assert.deepEqual(Object.keys(service.settings.preferences).sort(), ['provider', 'target']);
  assert.equal(new TranslationService(service.settings).snapshot().text, '');
});
test('cancel, clear, newer requests and duplicate runs cannot publish stale results', async () => {
  const pending = [];
  const service = harness((_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal })));
  const first = service.update({ text: 'first', provider: 'ai', target: 'auto' });
  const oldRun = service.translate(first.revision); await service.translate(first.revision); assert.equal(pending.length, 1);
  const next = service.update({ text: 'next', provider: 'ai', target: 'auto' }); assert.equal(pending[0].signal.aborted, true);
  const newRun = service.translate(next.revision); pending[1].resolve(response({ choices: [{ message: { content: 'NEW' } }] })); await newRun;
  pending[0].resolve(response({ choices: [{ message: { content: 'OLD' } }] })); await oldRun; assert.equal(service.snapshot().result, 'NEW');
  service.cancel(); assert.equal(service.snapshot().result, 'NEW');
  service.update({ text: '', provider: 'ai', target: 'auto' }); assert.equal(service.snapshot().result, '');
});
test('timeouts abort, retain original text and report retryable error without retries', async () => {
  let calls = 0;
  const service = harness((_url, { signal }) => new Promise((_resolve, reject) => { calls++; signal.addEventListener('abort', () => reject(Error('abort'))); }), 5);
  const state = service.update({ text: 'TEST_ONLY_ORIGINAL', provider: 'ai', target: 'auto' });
  const result = await service.translate(state.revision); assert.match(result.error, /超时/); assert.equal(result.text, state.text); assert.equal(calls, 1);
});
test('missing credentials and failed preference writes stop requests while retaining input', async () => {
  const service = harness(() => { throw Error('must not fetch'); });
  service.settings.configs = {};
  let state = service.update({ text: 'hello', provider: 'ai', target: 'auto' });
  assert.match((await service.translate(state.revision)).error, /配置/);
  service.settings.savePreferences = () => { throw Error('disk'); };
  state = service.update({ text: 'original retained', provider: 'ai', target: 'fr' }); assert.equal(state.text, 'original retained'); assert.equal(state.status, 'error');
});

test('model discovery reads IDs without a model, deduplicates and never saves or translates', async () => {
  const service = harness(async (url, options) => {
    assert.equal(url, config.baseUrl + '/models'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + config.apiKey); assert.equal(options.body, undefined);
    return response({ data: [{ id: 'test-z' }, { id: 'test-a' }, { id: 'test-z' }] });
  });
  const before = service.snapshot();
  assert.deepEqual(await service.listModels({ baseUrl: config.baseUrl, apiKey: config.apiKey }), ['test-a', 'test-z']);
  assert.deepEqual(service.snapshot(), before);
  service.fetchImpl = async (_url, options) => { assert.equal('Authorization' in options.headers, false); return response({ data: [{ id: 'test-local' }] }); };
  assert.deepEqual(await service.listModels({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }), ['test-local']);
});

test('model discovery sanitizes HTTP/JSON/network failures and allows manual fallback', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    const service = harness(async () => ({ ok: false, status }));
    await assert.rejects(service.listModels(config), /手动填写模型 ID/);
  }
  for (const data of [{}, { data: [] }, { data: [{ id: 1 }] }, { data: [null] }, { data: [{ id: ' ' }] }, { data: [{ id: 'bad\nheader' }] }, { data: Array(10001).fill({ id: 'test' }) }]) {
    const service = harness(async () => response(data));
    await assert.rejects(service.listModels(config), /手动填写模型 ID/);
  }
  for (const fetchImpl of [async () => { throw Error('TEST_ONLY_SECRET'); }, async () => ({ ok: true, json: async () => { throw Error('TEST_ONLY_SECRET'); } })]) {
    await assert.rejects(harness(fetchImpl).listModels(config), error => /手动填写/.test(error.message) && !error.message.includes('SECRET'));
  }
});

test('model discovery times out and does not retry', async () => {
  let calls = 0;
  const service = harness((_url, { signal }) => new Promise((_resolve, reject) => { calls++; signal.addEventListener('abort', () => reject(Error('TEST_ONLY_ABORT'))); }));
  service.modelsTimeoutMs = 5;
  await assert.rejects(service.listModels(config), /获取模型超时.*手动填写/); assert.equal(calls, 1);
});

