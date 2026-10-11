<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { WeatherLocation, WeatherRegion } from '../../shared/contracts';

const props = defineProps<{ location: WeatherLocation | null; disabled: boolean; saving: boolean }>();
const emit = defineEmits<{ save: [code: string] }>();
const bridge = window.deskIsland;
const options = ref<WeatherRegion[][]>([[], [], []]);
const codes = ref<string[]>(['', '', '']);
const busy = ref(false);
const error = ref('');
const labels = ['省 / 直辖市', '城市', '区 / 县'];
const selectedCode = computed(() => codes.value[2]);
const savedLabel = computed(() => props.location ? (props.location.regionCodes?.length === 4 ? props.location.region : [props.location.name, props.location.region].filter(Boolean).join(' · ')) : '尚未设置地点');
const hiddenLevel = (level: number) => (level === 1 || level === 2) && options.value[level].length === 1 &&
  options.value[level][0].name === options.value[level - 1].find(item => item.code === codes.value[level - 1])?.name;

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try { await action(); }
  catch (value) { error.value = value instanceof Error ? value.message : '操作失败，请重试'; }
  finally { busy.value = false; }
}

async function loadChildren(level: number) {
  if (level >= 2 || !codes.value[level]) return;
  options.value[level + 1] = await bridge.listWeatherRegions(codes.value[level]);
  if (hiddenLevel(level + 1)) {
    codes.value[level + 1] = options.value[level + 1][0].code;
    await loadChildren(level + 1);
  }
}

async function selectRegion(level: number) {
  await run(async () => {
    for (let index = level + 1; index < 3; index++) {
      codes.value[index] = '';
      options.value[index] = [];
    }
    await loadChildren(level);
  });
}

function save() {
  if (busy.value || props.disabled || props.saving || !selectedCode.value) return;
  emit('save', selectedCode.value);
}

onMounted(() => {
  void run(async () => {
    options.value[0] = await bridge.listWeatherRegions();
    for (let level = 0; level < Math.min(3, props.location?.regionCodes?.length ?? 0); level++) {
      const code = props.location!.regionCodes![level];
      if (!options.value[level]?.some(item => item.code === code)) break;
      codes.value[level] = code;
      await loadChildren(level);
    }
  });
});
</script>

<template>
  <section class="city-settings" aria-label="天气地点设置">
    <p><span>{{ savedLabel }}</span></p>
    <form @submit.prevent="save">
      <div class="region-selects">
        <label v-for="(label, level) in labels" v-show="!hiddenLevel(level)" :key="level">
          <span>{{ label }}</span>
          <select v-model="codes[level]" :aria-label="label" :disabled="busy || disabled || saving || !options[level].length" @change="selectRegion(level)">
            <option value="">{{ `请选择${label}` }}</option>
            <option v-for="region in options[level]" :key="region.code" :value="region.code">{{ region.name }}</option>
          </select>
        </label>
      </div>
      <button type="submit" :disabled="busy || disabled || saving || !selectedCode">{{ saving ? '保存中…' : busy ? '处理中…' : '保存地点' }}</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.city-settings{margin:0;padding:0}
.city-settings p{margin:0 0 10px}.city-settings p span{color:#e6e2e6;font-size:12px}
.region-selects{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.region-selects label{flex:1 1 130px;min-width:0}
.region-selects label>span{display:block;font-size:12px;color:#e6e2e6;margin-bottom:6px}
select{width:100%;font:inherit;background:#15171b;color:inherit;border:1px solid #ffffff40;border-radius:8px;padding:8px;cursor:pointer}
select:focus-visible{outline:2px solid #eee9ef;outline-offset:3px}select:disabled{opacity:.5;cursor:default}
select,select::picker(select){appearance:base-select}
select{background:#ffffff0c;border-radius:12px;transition:background .18s,border-color .18s}
select:hover:not(:disabled),select:open{background:#ffffff18;border-color:#ffffff70}
select::picker-icon{transition:rotate .2s}select:open::picker-icon{rotate:180deg}
select::picker(select){background:#202127ee;color:#fafafa;border:1px solid #ffffff40;border-radius:14px;padding:6px;margin-top:6px;max-height:260px;overflow:auto;box-shadow:0 12px 30px #0006;backdrop-filter:blur(20px);opacity:0;transform:translateY(-6px) scale(.98);transform-origin:top;transition:opacity .18s,transform .18s,display .18s allow-discrete,overlay .18s allow-discrete}
select:open::picker(select){opacity:1;transform:translateY(0) scale(1)}
@starting-style{select:open::picker(select){opacity:0;transform:translateY(-6px) scale(.98)}}
option{padding:9px 10px;border-radius:8px;cursor:pointer}option:hover,option:focus,option:checked{background:#ffffff1a}option::checkmark{margin-left:auto;order:1}
select::picker(select){scrollbar-width:thin;scrollbar-color:#ffffff40 transparent}
@media(prefers-reduced-motion:reduce){select,select::picker-icon,select::picker(select){transition:none}}
button{border:1px solid #ffffff26;background:#ffffff10;color:inherit;border-radius:8px;padding:8px 12px}button:disabled{opacity:.5}
.city-settings .error{margin:10px 0 0}
</style>
