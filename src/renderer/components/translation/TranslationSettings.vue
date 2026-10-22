<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TranslationReasoningEffort, TranslationSettingsStatus } from '../../../shared/contracts';
import catalog from '../../../shared/translation-catalog.json';
const status = ref<TranslationSettingsStatus | null>(null);
const apiKey = ref(''), baseUrl = ref(''), model = ref(''), reasoningEffort = ref<TranslationReasoningEffort>(''), prompt = ref(catalog.defaultPrompt);
const models = ref<string[]>([]), busy = ref(false), loadingModels = ref(false), error = ref(''), saved = ref(false);
const copiedVariable = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const locked = computed(() => busy.value || loadingModels.value || !status.value || !!status.value.error);
watch([baseUrl, apiKey], () => { if (!busy.value) { models.value = []; error.value = ''; } }, { flush: 'sync' });
watch([baseUrl, apiKey, model, reasoningEffort, prompt], () => { saved.value = false; }, { flush: 'sync' });
function messageFrom(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error|TypeError): /, '') : fallback;
}
async function copyPromptVariable(token: string) {
  if (locked.value) return;
  try {
    await window.deskIsland.copyTranslationPromptVariable(token);
    copiedVariable.value = token;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedVariable.value = ''; }, 1500);
  } catch (cause) { error.value = messageFrom(cause, '复制字段失败'); }
}
async function loadModels() {
  if (locked.value) return;
  loadingModels.value = true; error.value = ''; models.value = [];
  try { models.value = await window.deskIsland.listTranslationModels({ baseUrl: baseUrl.value, apiKey: apiKey.value }); }
  catch (cause) { error.value = messageFrom(cause, '获取模型失败，可手动填写模型 ID'); }
  finally { loadingModels.value = false; }
}
async function save() {
  if (locked.value) return;
  busy.value = true; error.value = ''; saved.value = false;
  try {
    const nextStatus = await window.deskIsland.saveTranslationConfig('ai', { apiKey: apiKey.value, baseUrl: baseUrl.value, model: model.value, reasoningEffort: reasoningEffort.value, prompt: prompt.value });
    status.value = nextStatus;
    apiKey.value = nextStatus.providers.ai.apiKey; saved.value = true;
  } catch (cause) { error.value = messageFrom(cause, '配置未保存，请检查必填项和系统加密'); }
  finally { busy.value = false; }
}
onMounted(async () => {
  try {
    status.value = await window.deskIsland.getTranslationSettings();
    const config = status.value.providers.ai;
    baseUrl.value = config.baseUrl; apiKey.value = config.apiKey; model.value = config.model; reasoningEffort.value = config.reasoningEffort; prompt.value = config.prompt;
  }
  catch { error.value = '读取翻译配置失败，请重新打开主控'; }
});
onBeforeUnmount(() => { clearTimeout(copiedTimer); });
</script>
<template>
  <section class="translation-settings" aria-label="AI 翻译参数">
    <h2>AI 翻译</h2>
    <form @submit.prevent="save">
      <label>Base URL<input v-model="baseUrl" required placeholder="https://服务地址/v1" autocomplete="off" spellcheck="false" :disabled="locked" /></label>
      <label>API Key<input v-model="apiKey" type="text" autocomplete="off" spellcheck="false" :placeholder="status?.providers.ai.hasApiKey ? '已保存；留空保留' : '填写密钥；仅本机服务可留空'" :disabled="locked" /></label>
      <label class="model-field">模型 ID<div class="model-row"><input v-model="model" required placeholder="获取模型后选择，或手动填写" autocomplete="off" spellcheck="false" :disabled="locked" /><button type="button" :disabled="locked || !baseUrl.trim()" @click="loadModels">{{ loadingModels ? '获取中…' : '获取模型' }}</button></div></label>
      <label class="reasoning-field">思考强度<select v-model="reasoningEffort" :disabled="locked"><option value="">默认</option><option v-for="level in catalog.reasoningEfforts" :key="level" :value="level">{{ level }}</option></select></label>
      <label v-if="models.length" class="full-width">可选模型<select v-model="model" :disabled="locked"><option value="" disabled>请选择模型 ID</option><option v-if="model && !models.includes(model)" :value="model">{{ model }}（手动填写）</option><option v-for="id in models" :key="id" :value="id">{{ id }}</option></select></label>
      <label class="full-width">自定义提示词<textarea v-model="prompt" rows="7" required :maxlength="catalog.maxPrompt" :disabled="locked"></textarea></label>
      <div class="prompt-fields full-width" aria-label="提示词字段库"><span>字段库</span><button v-for="field in catalog.promptVariables" :key="field.token" type="button" :disabled="locked" :aria-label="`复制 ${field.token}（${field.label}）`" @click="copyPromptVariable(field.token)"><code>{{ field.token }}</code><span>{{ copiedVariable === field.token ? '已复制' : field.label }}</span></button></div>
      <button type="button" :disabled="locked" @click="prompt = catalog.defaultPrompt">恢复默认模板</button>
      <button type="submit" :disabled="locked">{{ busy ? '保存中…' : '保存个人配置' }}</button>
    </form>
    <p v-if="status?.error || error" class="error" role="alert">{{ status?.error || error }}</p><p v-if="saved" role="status">已保存</p>
  </section>
</template>
<style scoped>
.translation-settings{margin-top:18px;padding-top:16px;border-top:1px solid #ffffff26}.translation-settings h2{font-size:15px;font-weight:500}.translation-settings p{font-size:12px;color:#e6e2e6;line-height:1.6}.translation-settings form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.translation-settings label{display:flex;flex-direction:column;gap:6px;font-size:12px}.translation-settings input,.translation-settings select,.translation-settings textarea{width:100%;min-width:0;padding:9px;border:1px solid #ffffff40;border-radius:9px;background:#24242b;color:inherit;font:inherit}.translation-settings textarea{resize:vertical;min-height:90px}.translation-settings .full-width{grid-column:1/-1;margin:0}.translation-settings button{padding:9px 12px;border:1px solid #ffffff40;border-radius:9px;background:#ffffff14;color:inherit;font:inherit;cursor:pointer;align-self:end}.translation-settings .model-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.translation-settings .model-row button{white-space:nowrap}.translation-settings .prompt-fields{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}.translation-settings .prompt-fields>button{display:inline-flex;align-items:baseline;gap:7px;padding:6px 9px;border-radius:99px}.translation-settings .prompt-fields code{font-size:12px}.translation-settings .prompt-fields button span{font-size:11px;color:#e6e2e6}.translation-settings :disabled{opacity:.5}.translation-settings .error{color:#ffc6aa}
</style>
