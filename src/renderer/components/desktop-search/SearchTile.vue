<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DesktopSearchItem } from '../../../shared/contracts';
import { nameParts, searchText, resultLayout } from '../../../shared/desktop-search';

const props = withDefaults(defineProps<{ preview?: boolean; width?: number }>(), { width: 320 });
const query = ref('');
const input = ref<HTMLInputElement>();
const expanded = ref(false);
const items = ref<DesktopSearchItem[]>([]);
const icons = ref<Record<string, string | null>>({});
const loading = ref(false);
const error = ref('');
const warning = ref('');
const opening = ref(false);
const selected = ref('');
const desktopIconSize = ref(48);
let revision = 0;
let removeCollapsedListener: (() => void) | undefined;
const matches = computed(() => {
  const needle = searchText(query.value.trim());
  return needle ? items.value.filter(item => searchText(item.name).includes(needle)) : [];
});
const layout = computed(() => resultLayout(props.width, matches.value.length, desktopIconSize.value));
const showResults = computed(() => expanded.value && matches.value.length > 0);
const status = computed(() => !expanded.value ? '' : error.value || (query.value.trim()
  ? warning.value || (loading.value ? '正在搜索…' : matches.value.length ? '' : '该内容不存在') : ''));
const desiredHeight = computed(() => Math.ceil(props.width / 5 + (showResults.value ? 8 + layout.value.panelHeight : 0) + (status.value ? 40 : 0)));

watch(desiredHeight, height => {
  if (!expanded.value) return;
  const current = revision;
  void window.deskIsland.resizeDesktopSearch(height).catch(reason => {
    if (current === revision) error.value = reason instanceof Error ? reason.message : '无法调整搜索结果高度';
  });
});

watch(matches, results => {
  selected.value = '';
  const current = revision;
  for (const item of results) {
    if (Object.hasOwn(icons.value, item.id)) continue;
    icons.value[item.id] = null;
    void window.deskIsland.getDesktopSearchIcon(item.id).then(icon => { if (current === revision) icons.value[item.id] = icon; }).catch(() => {});
  }
});

async function load() {
  const current = revision;
  loading.value = true;error.value = '';
  try {
    const result = await window.deskIsland.listDesktopSearchItems();
    if (current === revision) { items.value = result.items;warning.value = result.warnings.join('；');desktopIconSize.value = result.iconSize; }
  } catch (reason) { if (current === revision) error.value = reason instanceof Error ? reason.message : '无法读取桌面，请重试'; }
  finally { if (current === revision) loading.value = false; }
}

async function expand() {
  if (props.preview || expanded.value) return;
  expanded.value = true;error.value = '';revision++;
  const current = revision;
  try {
    await window.deskIsland.openDesktopSearch();
    if (current !== revision) return;
    await nextTick();input.value?.focus();void load();
  } catch (reason) {
    if (current === revision) { collapse();error.value = reason instanceof Error ? reason.message : '无法展开桌面搜索'; }
  }
}

async function open(item: DesktopSearchItem) {
  if (opening.value) return;
  const current = revision;
  opening.value = true;error.value = '';
  try { await window.deskIsland.openDesktopSearchItem(item.id); }
  catch (reason) { if (current === revision) error.value = reason instanceof Error ? reason.message : '无法打开项目'; }
  finally { if (current === revision) opening.value = false; }
}

function collapse() {
  revision++;expanded.value = false;query.value = '';items.value = [];icons.value = {};
  error.value = '';warning.value = '';loading.value = false;opening.value = false;input.value?.blur();
}
function close() { void window.deskIsland.closeDesktopSearch().catch(() => {}); }
onMounted(() => { if (!props.preview) removeCollapsedListener = window.deskIsland.onDesktopSearchCollapsed(collapse); });
onBeforeUnmount(() => { revision++;removeCollapsedListener?.(); });
</script>

<template>
  <section class="search-tile" :class="{ 'search-tile--expanded': expanded }" :style="{ '--icon-size': `${layout.iconSize}px`, '--row-height': `${layout.rowHeight}px` }" @contextmenu.prevent @keydown.esc.stop.prevent="close">
    <div class="search-field" :style="{ height: `${width / 5}px` }">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
      <input ref="input" v-model="query" :disabled="preview" type="text" role="searchbox" aria-label="搜索桌面" placeholder="搜索桌面…" autocomplete="off" spellcheck="false" @focus="expand" @click="expand" />
    </div>
    <p v-if="status" class="search-status" role="status">{{ status }} <button v-if="error && !items.length" type="button" @click="load">重试</button></p>
    <div v-if="showResults" class="search-results" :style="{ height: `${layout.panelHeight}px` }">
      <ul class="search-grid" :style="{ gridTemplateColumns: `repeat(${layout.columns},minmax(0,1fr))` }" aria-label="桌面搜索结果" @wheel.stop>
        <li v-for="item in matches" :key="item.id">
          <button type="button" class="search-result" :class="{ selected: selected === item.id }" :title="`${item.name}\n${item.path}`" :aria-label="`打开 ${item.name}`" :disabled="opening"
            @click="selected = item.id; open(item)" @keydown.enter.prevent @keydown.space.prevent>
            <span class="search-item-content">
              <img v-if="icons[item.id]" :src="icons[item.id]!" alt="" draggable="false" />
              <svg v-else viewBox="0 0 32 32" class="search-fallback" aria-hidden="true"><path v-if="item.kind === 'folder'" d="M3 7h11l3 4h12v16H3Z"/><path v-else d="M8 3h11l6 6v20H8Z M19 3v7h6"/></svg>
              <span class="search-name"><template v-for="(part,index) in nameParts(item.name, query)" :key="index"><strong v-if="part.matched">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></span>
            </span>
          </button>
        </li>
      </ul>
    </div>
    <p v-if="!expanded && error" class="search-error--collapsed" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.search-tile{height:100%;display:flex;flex-direction:column;gap:8px;color:#eee9ef}
.search-field,.search-results{background:rgba(8,10,14,.34);border:1px solid #ffffff40;border-radius:20px}
.search-field{display:flex;gap:12px;align-items:center;padding:0 18px;flex-shrink:0}
.search-field svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.7;flex-shrink:0}
.search-field input{min-width:0;width:100%;background:none;border:0;color:#eee9ef;font:inherit;font-size:16px;user-select:text}
.search-field input:disabled{opacity:1}.search-field input:focus-visible{outline:none}.search-field:focus-within{border-color:#71e8ff}
.search-results{display:flex;min-height:0;padding:12px;overflow:hidden;flex-shrink:1}
.search-grid{display:grid;grid-auto-rows:var(--row-height);align-content:start;gap:8px;overflow-y:auto;min-height:0;width:100%;list-style:none;margin:0;padding:0;scrollbar-width:none}
.search-grid::-webkit-scrollbar{display:none}
.search-result{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:10px 4px;border:1px solid transparent;border-radius:12px;color:#eee9ef;background:transparent;cursor:default}
.search-result:hover,.search-result.selected{background:#ffffff12;border-color:#ffffff26}
.search-item-content{display:flex;flex-direction:column;align-items:center;gap:8px;width:100%}
.search-result img,.search-fallback{width:var(--icon-size);height:var(--icon-size);object-fit:contain;flex-shrink:0}
.search-fallback{fill:#b9cddd;stroke:#eee9ef;stroke-width:1}
.search-name{font-size:12px;font-weight:400;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;width:100%;text-align:center}
.search-name strong{font-weight:750;color:#36e1ff}
.search-status{height:32px;flex-shrink:0;margin:0;display:flex;align-items:center;justify-content:center;gap:6px;color:#ffc6aa;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.search-status button{background:#ffffff14;border:0;border-radius:6px;color:inherit;cursor:pointer}
.search-error--collapsed{position:absolute;left:8px;right:8px;bottom:0;margin:0;font-size:11px;color:#ffc6aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#17161b}
</style>
