const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const filename = require.resolve('../src/renderer/components/translation/translation-controller.ts');
const compiled = new Module(filename, module); compiled.filename = filename; compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { TranslationController } = compiled.exports;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let state = { provider: 'ai', target: 'auto', text: '', result: '', error: '', status: 'idle', revision: 0 };
  const calls = [], pending = [];
  const bridge = {
    getTranslation: async () => ({ ...state }),
    updateTranslation: async input => { state = { ...state, ...input, revision: state.revision + 1, result: '', status: input.text.length > 5000 ? 'error' : 'idle', error: input.text.length > 5000 ? '超限' : '' }; return { ...state }; },
    translate: revision => { calls.push(revision); return new Promise(resolve => pending.push(result => resolve({ ...state, status: 'done', result }))); },
    cancelTranslation: async () => ({ ...state, revision: ++state.revision }),
  };
  const controller = new TranslationController(bridge, () => {}); t.after(() => controller.dispose());
  return { controller, calls, pending, bridge, input: text => controller.change({ text, provider: 'ai', target: 'auto' }), submit: text => controller.submit({ text, provider: 'ai', target: 'auto' }) };
}
test('typing and changing language never auto-send; explicit submit translates the latest draft', async t => {
  const h = harness(t); await h.input('a'); t.mock.timers.tick(5000); await flush(); assert.equal(h.calls.length, 0);
  await h.input('ab'); t.mock.timers.tick(5000); await flush(); assert.equal(h.calls.length, 0);
  await h.controller.change({ text: 'ab', provider: 'ai', target: 'fr' }); assert.equal(h.calls.length, 0);
  void h.submit('ab'); await flush(); assert.equal(h.calls.length, 1); assert.equal(h.controller.state.text, 'ab');
  void h.submit('ab'); await flush(); assert.equal(h.calls.length, 1);
  h.pending[0]('测试译文'); await flush(); assert.equal(h.controller.state.result, '测试译文');
});
test('input never translates on composition commit; auto target stays submit-ready and oversize drafts block submit', async t => {
  const h = harness(t); await h.input('にほん');
  t.mock.timers.tick(2000); await flush(); assert.equal(h.calls.length, 0);
  await h.input('日本語です'); t.mock.timers.tick(2000); await flush(); assert.equal(h.calls.length, 0);
  void h.submit('日本語です'); await flush(); assert.equal(h.calls.length, 1);
  await h.input('中文'); void h.submit('中文'); await flush(); assert.equal(h.calls.length, 2);
  await h.input('a'.repeat(5001)); await h.submit('a'.repeat(5001)); assert.equal(h.calls.length, 2); assert.equal(h.controller.state.text.length, 5001);
  await h.submit(''); assert.equal(h.calls.length, 2);
});
test('late replies, clear, pause and disposal cannot overwrite new contents or resume requests', async t => {
  const h = harness(t); void h.submit('old'); await flush();
  await h.input('new'); void h.submit('new'); await flush(); h.pending[1]('新译文'); await flush(); h.pending[0]('旧译文'); await flush(); assert.equal(h.controller.state.result, '新译文');
  h.input(''); t.mock.timers.tick(1000); await flush(); assert.equal(h.controller.state.result, ''); assert.equal(h.calls.length, 2);
  void h.submit('pause'); h.controller.pause(); await flush(); assert.equal(h.calls.length, 2);
  void h.submit('dispose'); h.controller.dispose(); await flush(); assert.equal(h.calls.length, 2);
});
test('missing/failed bridge never produces unhandled rejections and load does not auto-send', async t => {
  const h = harness(t); await h.controller.load(); t.mock.timers.tick(1000); await flush(); assert.equal(h.calls.length, 0);
  h.bridge.updateTranslation = async () => { throw Error('test'); }; await h.submit('retry'); assert.equal(h.controller.state.status, 'error'); assert.equal(h.calls.length, 0);
});

test('submit waits for the draft acknowledgment and a subsequent edit invalidates it', async t => {
  const h = harness(t); let acknowledge;
  h.bridge.updateTranslation = () => new Promise(resolve => { acknowledge = resolve; });
  void h.submit('old'); await flush(); assert.equal(h.calls.length, 0);
  const oldAcknowledgment = acknowledge;
  void h.input('new');
  oldAcknowledgment({ ...h.controller.state, text: 'old', status: 'idle', revision: 1 });
  await flush(); assert.equal(h.calls.length, 0); assert.equal(h.controller.state.text, 'new');
});
test('preview is explicit, text is rendered without HTML, and clipboard access only writes the result', () => {
  const tile = fs.readFileSync(require.resolve('../src/renderer/components/translation/TranslationTile.vue'), 'utf8');
  assert.match(tile, /预览示例/); assert.doesNotMatch(tile, /v-html|clipboard\.read|setInterval/); assert.match(tile, /if \(!props.preview\)/);
  assert.match(tile, /compositionstart/); assert.match(tile, /compositionend/);
});
test('translation settings pair model discovery with the ID, expose a visible key and copyable prompt fields', () => {
  const settings = fs.readFileSync(require.resolve('../src/renderer/components/translation/TranslationSettings.vue'), 'utf8');
  assert.match(settings, /class="model-row"/); assert.match(settings, /class="reasoning-field"/);
  assert.match(settings, /type="text"/); assert.doesNotMatch(settings, /type="password"/);
  assert.match(settings, /apiKey\.value = config\.apiKey/); assert.match(settings, /apiKey\.value = nextStatus\.providers\.ai\.apiKey/);
  assert.match(settings, /catalog\.promptVariables/); assert.match(settings, /copyTranslationPromptVariable/);
  assert.match(settings, /catalog\.reasoningEfforts/); assert.doesNotMatch(settings, /testTranslationReasoning|reasoning-badge|强度未回传/);
  assert.equal((settings.match(/<p\s/g) || []).length, 2);
  for (const text of ['使用你自己的 OpenAI', '获取模型只读取列表', '选择后会发送', '这里是每次发送', 'Base URL 后会追加']) assert.doesNotMatch(settings, new RegExp(text));
});
