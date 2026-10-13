<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { widgetCatalog, getWidgetDefinition } from '../shared/catalog';
import type { AudioSnapshot, MediaSnapshot, WeatherLocation, WidgetInstance, WidgetType, WidgetVariant } from '../shared/contracts';
import MusicTile from './components/MusicTile.vue';
import AudioTile from './components/audio/AudioTile.vue';
import SearchTile from './components/desktop-search/SearchTile.vue';
import CountdownTile from './components/countdown/CountdownTile.vue';
import TodoTile from './components/todo/TodoTile.vue';
import type { TodoItem } from '../shared/contracts';
import WeatherIcon from './components/WeatherIcon.vue';
import WeatherLocationSettings from './components/WeatherLocationSettings.vue';

const bridge = window.deskIsland;
const widgets = ref<WidgetInstance[]>([]);
const selectedType = ref<WidgetType>('music');
const settingsPage = ref(false);
const appVersion = ref('');
const startup = ref({ supported: false, enabled: false });
const editMode = ref(false);
const busy = ref(false);
const errorMessage = ref('');
const audioRecording = ref<Pick<AudioSnapshot['recording'],'status'|'message'>>({status:'idle'});
let removeAudioListener:(()=>void)|undefined;
const weatherEnabled = ref(true);
const savingLocations = ref<Record<string, boolean>>({});
const weatherWidgets = computed(() => widgets.value.filter(item => item.typeId === 'weather'));
const focusedWeatherId = ref('');
const credentialStatus = ref<Awaited<ReturnType<typeof bridge.getWeatherCredentialsStatus>>>({ configured: false, host: '', mode: 'none', error: '' });
const apiHost = ref('');
const apiKey = ref('');
const credentialSaved = ref(false);
const weatherDrafts = ref<Record<string,string[]>>({});
let removeClosingListener:(()=>void)|undefined;
let requestedWeatherId='';
const definition = computed(() => getWidgetDefinition(selectedType.value));
const currentWidget = computed(() => widgets.value.find(item => item.typeId === selectedType.value));
const previewMedia: MediaSnapshot = { available: true, title: '午后留声 · 示例歌曲', artist: '示例歌手', playbackStatus: 'Playing', durationTicks: 1_980_000_000 };
const previewTodos: TodoItem[] = [
  {id:'preview-1',text:'论文 · 示例',color:'yellow',remindAt:null,reminderState:null},
  {id:'preview-2',text:'阅读 · 示例',color:'green',remindAt:null,reminderState:null},
];
let removeEditListener: (() => void) | undefined;
let removeWeatherListener: (() => void) | undefined;
let removeErrorListener: (() => void) | undefined;

async function run(action: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  try { await action(); errorMessage.value = ''; }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : '操作失败，请重试'; }
  finally { busy.value = false; }
}
function closeControl() {
  return bridge.hideControlWindow({selectedType:selectedType.value,settingsPage:settingsPage.value,focusedWeatherId:focusedWeatherId.value,
    apiHost:apiHost.value,apiKey:apiKey.value,weatherCodes:Object.fromEntries(Object.entries(weatherDrafts.value).map(([id,codes])=>[id,[...codes]]))});
}
async function refresh() {
  widgets.value = await bridge.listWidgets();
  weatherEnabled.value = await bridge.getWeatherEnabled();
}
async function selectVariant(variantId: WidgetVariant) {
  await run(async () => {
    const widget = currentWidget.value;
    if (widget) await bridge.setWidgetVariant(widget.id, variantId);
    await refresh();
  });
}
async function openSettings() {
  settingsPage.value = true;
  await run(async () => { startup.value = await bridge.getStartupSettings(); });
}
async function changeStartup() {
  const enabled = !startup.value.enabled;
  await run(async () => { startup.value = await bridge.setStartupSettings(enabled); });
}
async function saveWeatherLocation(id: string, code: string) {
  if (savingLocations.value[id]) return;
  savingLocations.value[id] = true;
  errorMessage.value = '';
  try {
    const location = await bridge.saveWeatherLocation(id, code);
    const widget = widgets.value.find(item => item.id === id);
    if (widget) widget.settings.location = location;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存地点失败，请重试';
  } finally {
    delete savingLocations.value[id];
  }
}
async function toggleWidget(typeId: WidgetType) {
  await run(async () => {
    if (typeId === 'weather') {
      await bridge.setWeatherEnabled(!weatherEnabled.value);
      await refresh();
      return;
    }
    const widget = widgets.value.find(item => item.typeId === typeId);
    if (widget) await bridge.setWidgetEnabled(widget.id, !widget.enabled);
    else await bridge.createWidget(typeId, getWidgetDefinition(typeId).variants[0].id);
    await refresh();
  });
}
async function addWeather() {
  let id = '';
  await run(async () => {
    const widget = await bridge.createWidget('weather', 'standard', false);
    id = widget.id;
    await refresh();
  });
  if (id) await focusWeather(id);
}
async function focusWeather(id: string) {
  focusedWeatherId.value = id;
  await nextTick();
  const row = document.getElementById(`weather-row-${id}`);
  row?.scrollIntoView({ block: 'nearest' });
  row?.focus();
  const select = row?.querySelector<HTMLSelectElement>('select');
  if (select && !select.disabled) select.focus();
}
async function toggleWeather(widget: WidgetInstance) {
  await run(async () => { await bridge.setWidgetEnabled(widget.id, !widget.enabled); await refresh(); });
}
async function setWeatherVariant(widget: WidgetInstance, event: Event) {
  const variantId = (event.target as HTMLSelectElement).value as WidgetVariant;
  await run(async () => { await bridge.setWidgetVariant(widget.id, variantId); await refresh(); });
}
async function removeWeather(id: string) {
  if (savingLocations.value[id]) return;
  await run(async () => { await bridge.removeWidget(id); await refresh(); });
}
async function saveCredentials() {
  credentialSaved.value = false;
  await run(async () => {
    credentialStatus.value = await bridge.saveWeatherCredentials({ host: apiHost.value, apiKey: apiKey.value });
    apiKey.value = '';
    credentialSaved.value = true;
  });
}
onMounted(() => {
  removeClosingListener=bridge.onControlClosing(()=>{void run(closeControl);});
  removeAudioListener=bridge.onAudioRecordingChanged?.(recording=>{audioRecording.value=recording;});
  removeWeatherListener=bridge.onWeatherConfigurationRequest(async(id)=>{
    requestedWeatherId=id;
    settingsPage.value=false;selectedType.value='weather';await focusWeather(id);
  });
  removeErrorListener=bridge.onDesktopError(message=>{errorMessage.value=message;});
  removeEditListener = bridge.onEditModeChange(enabled => { editMode.value = enabled; });
  void run(async () => {
    const draft=await bridge.getControlState();
    if(draft) {selectedType.value=draft.selectedType;settingsPage.value=draft.settingsPage;focusedWeatherId.value=draft.focusedWeatherId;weatherDrafts.value=draft.weatherCodes??{};apiHost.value=draft.apiHost??'';apiKey.value=draft.apiKey??'';}
    appVersion.value = (await bridge.getAppInfo()).version;
    if(bridge.getAudioSnapshot) audioRecording.value=(await bridge.getAudioSnapshot()).recording;
    await refresh(); editMode.value = await bridge.getEditMode();
    credentialStatus.value = await bridge.getWeatherCredentialsStatus();
    if(!draft) apiHost.value = credentialStatus.value.host;
    if(settingsPage.value) startup.value=await bridge.getStartupSettings();
    if(requestedWeatherId) {settingsPage.value=false;selectedType.value='weather';await focusWeather(requestedWeatherId);}
  });
});
onBeforeUnmount(() => {removeClosingListener?.();removeAudioListener?.();removeEditListener?.();removeWeatherListener?.();removeErrorListener?.();});
</script>

<template>
  <main class="control">
    <header class="titlebar">
      <div class="brand">桌屿 <span>DeskIsland {{ appVersion }}</span></div>
      <div class="window-actions">
        <button type="button" aria-label="最小化" @click="run(() => bridge.minimizeControlWindow())">−</button>
        <button type="button" aria-label="收起到托盘" @click="run(closeControl)">×</button>
      </div>
    </header>
    <div class="app-layout">
      <nav class="sidebar" aria-label="磁贴分类">
        <p>磁贴分类</p>
        <div v-for="item in widgetCatalog" :key="item.typeId" class="category-row" :class="{ selected: !settingsPage && selectedType === item.typeId }">
          <button type="button" class="category-button" :aria-pressed="!settingsPage && selectedType === item.typeId" @click="settingsPage = false; selectedType = item.typeId">{{ item.title }}</button>
          <button type="button" class="widget-switch" role="switch" :aria-label="`${item.title}磁贴`" :aria-checked="item.typeId === 'weather' ? weatherEnabled : widgets.some(widget => widget.typeId === item.typeId && widget.enabled)" :disabled="busy" @click="toggleWidget(item.typeId)"><span></span></button>
        </div>
        <button type="button" class="settings-button category-button" :class="{ selected: settingsPage }" :aria-pressed="settingsPage" :disabled="busy" @click="openSettings">设置</button>
      </nav>
      <div class="content">
        <div class="section-heading">
          <div><h1>{{ settingsPage ? '设置' : definition.title }}</h1></div>
          <button type="button" class="edit-button" :class="{ active: editMode }" :aria-pressed="editMode" :disabled="busy" @click="run(async () => { editMode = await bridge.setEditMode(!editMode); })">{{ editMode ? '完成编辑' : '编辑桌面' }}</button>
        </div>
        <p v-if="editMode" class="edit-hint" role="status">拖动磁贴任意区域，四角缩放（待办宽高独立），松手按网格对齐。编辑时内部控件暂停操作，按 Esc 或「完成编辑」锁定布局。</p>
        <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
        <section v-if="settingsPage" class="general-settings" aria-label="程序设置">
          <div class="startup-setting"><span>开机自启</span><button type="button" class="widget-switch" role="switch" aria-label="开机自启" :aria-checked="startup.enabled" :disabled="busy || !startup.supported" @click="changeStartup"><span></span></button></div>
          <p v-if="!startup.supported" role="status">开发测试模式不修改 Windows 启动项，请在安装后的桌屿中设置。</p>
        </section>
        <!-- Keep region drafts mounted while navigating, including failed saves. -->
        <section v-show="!settingsPage && selectedType === 'weather'" class="weather-settings" aria-label="天气磁贴列表">
          <details class="weather-credentials">
            <summary>和风天气账户 · {{ credentialStatus.configured ? '已配置个人 KEY' : '未配置' }}</summary>
            <p>使用自己的免费注册账户与额度。启用磁贴时获取天气，之后每小时刷新；每次刷新包含 2 次 API 请求。</p>
            <div class="credential-links"><button type="button" @click="run(() => bridge.openWeatherLink('register'))">注册／登录和风天气</button><button type="button" @click="run(() => bridge.openWeatherLink('guide'))">获取 KEY 指引</button><button type="button" @click="run(() => bridge.openWeatherLink('pricing'))">免费额度与定价</button></div>
            <p>在控制台创建项目，选择 API KEY 凭据；API Host 在控制台「设置」中查看。每月前 50,000 次免费，超出可能收费。</p>
            <form @submit.prevent="saveCredentials">
              <label>API Host<input v-model="apiHost" autocomplete="off" spellcheck="false" placeholder="你的独立域名.qweatherapi.com" :disabled="busy" required /></label>
              <label>API KEY<input v-model="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="填写自己的 API KEY" :disabled="busy" required /></label>
              <button type="submit" :disabled="busy || !apiHost.trim() || !apiKey.trim() || !!credentialStatus.error">保存个人凭据</button>
            </form>
            <p v-if="credentialStatus.error" class="error" role="alert">{{ credentialStatus.error }}</p>
            <p v-if="credentialSaved" role="status">个人凭据已加密保存，已启用磁贴将使用此账户。KEY 不会回显。</p>
            <p v-if="!credentialStatus.configured">未配置和风凭据时使用 Open-Meteo 备用源。</p>
          </details>
          <div class="weather-table-heading"><h2>地区列表</h2><button type="button" :disabled="busy" @click="addWeather">添加天气磁贴</button></div>
          <p v-if="!weatherEnabled" class="empty">天气总开关已关闭，打开后显示已启用的磁贴。</p>
          <table class="weather-table">
            <thead><tr><th scope="col">选择地区</th><th scope="col">显示</th><th scope="col">类别</th><th scope="col">删除</th></tr></thead>
            <tbody>
              <tr v-for="(widget, index) in weatherWidgets" :id="`weather-row-${widget.id}`" :key="widget.id" tabindex="-1" :class="{ focused: focusedWeatherId === widget.id }">
                <td><WeatherLocationSettings :location="(widget.settings.location as WeatherLocation | null)" :draft-codes="weatherDrafts[widget.id]" :disabled="busy" :saving="!!savingLocations[widget.id]" @change="codes => weatherDrafts[widget.id]=codes" @save="code => saveWeatherLocation(widget.id, code)" /></td>
                <td><button type="button" class="widget-switch" role="switch" :aria-label="`显示第 ${index + 1} 个天气磁贴`" :aria-checked="widget.enabled" :disabled="busy" @click="toggleWeather(widget)"><span></span></button></td>
                <td><select :aria-label="`第 ${index + 1} 个天气磁贴类别`" :value="widget.variantId" :disabled="busy" @change="setWeatherVariant(widget, $event)"><option v-for="variant in getWidgetDefinition('weather').variants" :key="variant.id" :value="variant.id">{{ variant.title }}</option></select></td>
                <td><button type="button" :aria-label="`删除第 ${index + 1} 个天气磁贴`" :disabled="busy || !!savingLocations[widget.id]" @click="removeWeather(widget.id)">删除</button></td>
              </tr>
              <tr v-if="!weatherWidgets.length"><td colspan="4" class="empty">点击「添加天气磁贴」选择地区，新建磁贴默认不显示。</td></tr>
            </tbody>
          </table>
        </section>
        <div v-if="!settingsPage" class="catalog-grid">
          <article v-for="variant in definition.variants" :key="variant.id" class="variant-card" :class="{ chosen: selectedType === 'music' && currentWidget?.variantId === variant.id }">
            <div class="variant-title"><h2>{{ variant.title }}</h2><span>预览示例</span></div>
            <div class="preview-area">
              <div v-if="selectedType === 'music'" class="preview-tile" :class="variant.id === 'wide' ? 'preview-wide' : 'preview-square'">
                <MusicTile :wide="variant.id === 'wide'" preview :media="previewMedia" lyric="让这一刻，慢一点经过" :position="840_000_000" />
              </div>
              <div v-else-if="selectedType === 'desktop-search'" class="preview-search"><SearchTile preview /></div>
              <div v-else-if="selectedType === 'countdown'" class="preview-countdown"><CountdownTile preview /></div>
              <div v-else-if="selectedType === 'audio'" class="preview-countdown preview-audio"><AudioTile preview /></div>
              <div v-else-if="selectedType === 'todo'" class="preview-todo"><TodoTile :items="previewTodos" preview /></div>
              <div v-else class="preview-weather">
                <div>杭州 · 示例<WeatherIcon :code="2" condition="晴间多云" /></div><strong>24°</strong><p>晴间多云</p><small>最高 26°　最低 18°<br>天气数据为预览示例</small>
              </div>
            </div>
            <button v-if="selectedType === 'music'" type="button" class="variant-action" :class="{ current: currentWidget?.variantId === variant.id }" :disabled="busy || !currentWidget || currentWidget.variantId === variant.id" @click="selectVariant(variant.id)">{{ currentWidget?.variantId === variant.id ? '当前' : '切换' }}</button>
            <button v-else-if="selectedType === 'todo'" type="button" class="variant-action" :disabled="busy" @click="run(() => bridge.previewTodoReminder())">全屏预览</button>
          </article>
        </div>
        <p v-if="!settingsPage && selectedType === 'music' && !currentWidget" class="empty">打开侧边栏开关后可设置磁贴。</p>
        <p v-if="!settingsPage && selectedType === 'desktop-search'" class="empty">点击桌面搜索框，在原处输入，下方展开桌面项目；输入名称实时筛选，不搜索文件夹内部。单击打开结果，Esc 或点击外部收起。</p>
        <p v-if="!settingsPage && selectedType === 'countdown'" class="empty">打开开关显示倒计时。休眠和锁屏期间继续计时，恢复后提醒；退出程序或关闭磁贴会取消计时。</p>
        <p v-if="!settingsPage && selectedType === 'audio'" class="empty">切换系统默认设备，保留软件自己的设备选择。录音包含系统声音和默认通信麦克风；关闭磁贴开关会停止录音。取消保存会自动存到桌面。</p>
        <p v-if="!settingsPage && selectedType === 'audio' && audioRecording.status === 'error'" class="error" role="alert">{{ audioRecording.message }} <button type="button" :disabled="busy" @click="run(() => bridge.retrySaveAudioRecording())">重试保存录音</button></p>
        <p v-if="!settingsPage && selectedType === 'todo'" class="empty">打开侧边栏开关显示待办；点击桌面磁贴右下角＋添加事项。提醒仅在程序运行且磁贴开启时触发，错过不补提醒。</p>
      </div>
    </div>
  </main>
</template>

<style>
.preview-search{width:320px;height:64px;overflow:hidden}
.preview-countdown{width:240px;height:240px;border:1px solid #ffffff40;border-radius:20px;background:rgba(8,10,14,.34);overflow:hidden}
.preview-audio{height:160px}
.preview-todo{width:240px;height:240px;border-radius:20px;overflow:hidden}
.settings-button{position:absolute;bottom:24px;left:14px;width:132px}.settings-button.selected{background:#ffffff14;font-weight:600}.general-settings{padding:20px;border:1px solid #ffffff26;border-radius:12px;background:#ffffff08}.startup-setting{display:flex;align-items:center;gap:10px}.general-settings p{font-size:12px;line-height:1.7;color:#e6e2e6}.widget-switch:focus-visible{outline:2px solid #eee9ef;outline-offset:3px}
*{box-sizing:border-box}html,body,#app{height:100%;margin:0;background:transparent}body{font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:#fafafa;font-size:14px;color-scheme:dark}button,input{font:inherit}button{cursor:pointer;color:inherit}button:disabled{cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #eee9ef;outline-offset:3px}
.control{user-select:none;height:100%;overflow:hidden;background:rgba(8,10,14,.46);border:1px solid #ffffff40fff42;border-radius:20px;backdrop-filter:blur(16px) saturate(1.15);display:flex;flex-direction:column}.titlebar{height:54px;flex:none;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ffffff14;-webkit-app-region:drag;padding-left:23px;user-select:none}.brand{font-size:15px;font-weight:600}.brand span{font-size:12px;color:#e6e2e6;font-weight:400;margin-left:10px}.window-actions{display:flex;height:100%;-webkit-app-region:no-drag}.window-actions button{width:48px;border:0;background:transparent;font-size:21px}.window-actions button:hover{background:#ffffff14}.window-actions button:last-child:hover{background:#b93434;color:white}
.app-layout{display:grid;grid-template-columns:160px 1fr;min-height:0;flex:1}.sidebar{position:relative;padding:28px 14px;border-right:1px solid #ffffff14}.sidebar p{font-size:12px;margin:0 12px 16px;color:#e6e2e6}.category-row{display:flex;align-items:center;border-radius:10px;margin-bottom:6px;padding-right:10px}.category-row.selected{background:#ffffff14}.category-button{flex:1;min-width:0;border:0;background:transparent;padding:12px;text-align:left;border-radius:10px}.category-row.selected .category-button{font-weight:600}.widget-switch{flex:none;width:34px;height:20px;padding:2px;border:1px solid #ffffff40;border-radius:12px;background:#ffffff14}.widget-switch span{display:block;width:14px;height:14px;border-radius:50%;background:#e6e2e6;transition:transform .15s}.widget-switch[aria-checked="true"]{background:#eee9ef;border-color:#eee9ef}.widget-switch[aria-checked="true"] span{background:#28252a;transform:translateX(14px)}.widget-switch:disabled{opacity:.5}.content{padding:28px;overflow:auto;min-width:0}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.section-heading h1{font-weight:550;font-size:25px;margin:0}.edit-button{border:1px solid #ffffff40;background:#ffffff10;border-radius:10px;padding:11px 15px}.edit-button.active{background:#eee9ef;color:#28252a}.edit-hint{font-size:12px;line-height:1.6;padding:10px;background:#ffffff14;border-radius:8px}.error{color:#ffc6aa;font-size:13px;overflow-wrap:anywhere}.catalog-grid{display:grid;grid-template-columns:240px minmax(0,1fr);gap:16px}.variant-card{min-width:0;border:1px solid transparent;background:#ffffff08;border-radius:16px;padding:15px}.variant-card.chosen{border-color:#eee9ef}.variant-title{display:flex;justify-content:space-between;gap:8px;align-items:center}.variant-title h2{font-size:14px;font-weight:500;margin:0}.variant-title span{font-size:12px;color:#e6e2e6}.preview-area{height:270px;display:flex;align-items:center;justify-content:center}.preview-tile,.preview-weather{background:rgba(8,10,14,.34);border:1px solid #ffffff40;border-radius:20px;box-shadow:0 8px 23px #00000026;overflow:hidden}.preview-square{width:208px;height:208px;flex:none}.preview-square .music-face{width:240px;height:240px;transform:scale(.8666667);transform-origin:top left}.preview-wide{width:333px;height:167px;flex:none}.preview-wide .music-face{width:416px;height:208px;transform:scale(.8);transform-origin:top left}.variant-action{width:100%;padding:10px;border:1px solid transparent;border-radius:8px;background:#eee9ef;color:#28252a}.variant-action.current{background:transparent;border-color:#fff;color:#fafafa}.preview-weather{width:240px;height:192px;padding:18px;flex:none}.preview-weather>div{font-size:12px;color:#e6e2e6;display:flex;justify-content:space-between}.preview-weather strong{font-size:45px;font-weight:350;display:block;margin-top:8px}.preview-weather p{font-size:13px;margin:4px 0 14px}.preview-weather small{font-size:11px;color:#e6e2e6;line-height:1.8}
.weather-settings{margin-bottom:24px}.weather-table-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.weather-table-heading h2{font-size:14px;font-weight:500;margin:0}.weather-table{width:100%;border-collapse:collapse;table-layout:fixed}.weather-table th{font-size:12px;font-weight:500;color:#e6e2e6;text-align:left;padding:10px 8px}.weather-table td{padding:14px 8px;vertical-align:top;border-top:1px solid #ffffff26}.weather-table th:nth-child(2){width:58px}.weather-table th:nth-child(3){width:110px}.weather-table th:nth-child(4){width:64px}.weather-table tr.focused{background:#ffffff08}.weather-table-heading button,.weather-table td>button:not(.widget-switch),.weather-table select{font:inherit;border:1px solid #ffffff26;border-radius:8px;background:#15171b;color:inherit;padding:8px}.weather-table select{width:100%}.weather-table select:focus-visible{outline:2px solid #eee9ef;outline-offset:3px}.empty{font-size:12px;color:#e6e2e6}
</style>

<style>
.weather-credentials{margin-bottom:18px;padding:14px;border:1px solid #ffffff26;border-radius:12px;background:#ffffff08}.weather-credentials summary{cursor:pointer}.weather-credentials p{font-size:12px;line-height:1.7;color:#e6e2e6}.credential-links{display:flex;gap:8px;flex-wrap:wrap}.weather-credentials button,.weather-credentials input{font:inherit;color:inherit;border:1px solid #ffffff26;border-radius:8px;background:#15171b;padding:8px}.weather-credentials form{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.weather-credentials label{display:grid;gap:6px;flex:1;min-width:180px;font-size:12px}.weather-credentials input{width:100%;user-select:text}.weather-credentials button:disabled{opacity:.5}
</style>
