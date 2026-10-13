<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MusicTile from './components/MusicTile.vue';
import SearchTile from './components/desktop-search/SearchTile.vue';
import AudioTile from './components/audio/AudioTile.vue';
import CountdownTile from './components/countdown/CountdownTile.vue';
import TodoTile from './components/todo/TodoTile.vue';
import type { TodoItem } from '../shared/contracts';
import WeatherIcon from './components/WeatherIcon.vue';
import { activeLyric } from '../shared/lyrics';
import type { EditGesture, LyricsSnapshot, MediaSnapshot, WeatherLocation, WeatherSnapshot, WidgetInstance } from '../shared/contracts';
import { getWidgetDefinition } from '../shared/catalog';

const props = defineProps<{ widgetId: string }>();
const widget = ref<WidgetInstance | null>(null);
const media = ref<MediaSnapshot | null>(null);
const lyrics = ref<LyricsSnapshot | null>(null);
const weather = ref<WeatherSnapshot | null>(null);
const message = ref('');
const editError=ref('');
const active = ref(true);
const editMode = ref(false);
const positionPulse = ref(0);
const lyricsLoading = ref(false);
const lyricsError = ref('');
let mediaTimer: ReturnType<typeof setInterval> | undefined;
let weatherTimer: ReturnType<typeof setInterval> | undefined;
let positionTimer: ReturnType<typeof setInterval> | undefined;
let removeActiveListener: (() => void) | undefined;
let removeEditListener: (() => void) | undefined;
let removeSettingsListener: (() => void) | undefined;
let weatherRequestId=0;
let observedMediaAt = 0;
const liveWidth=ref(window.innerWidth);
const corners=['nw','ne','sw','se'] as const;
let removeBoundsListener: (() => void) | undefined;
let removeCancelListener: (() => void) | undefined;
let gesture: { pointerId:number;target:HTMLElement;token:Promise<number> } | null = null;
const dragging=ref(false);
let lyricTrackKey = '';
let lyricRequestId = 0;
let lyricAttempts = 0;
let lyricRetryAt = 0;
let mediaRefreshing = false;
let mediaVersion = 0;
const commandPending = ref(false);
let expectedPlayback: { status: string; until: number; sourceId?: string } | null = null;
let disposed = false;

const isMusic = computed(() => widget.value?.typeId === 'music');
const baseSize=computed(()=>widget.value ? getWidgetDefinition(widget.value.typeId).variants.find(item=>item.id===widget.value!.variantId)!.size : {width:240,height:240});
const compact=computed(()=>liveWidth.value<baseSize.value.width);
const contentStyle=computed(()=>{
  if(['todo','desktop-search'].includes(widget.value?.typeId ?? '')) return {width:'100%',height:'100%',transform:'none'};
  if(widget.value?.typeId==='countdown') return {width:`${baseSize.value.width}px`,height:`${baseSize.value.height}px`,transform:`scale(${liveWidth.value/baseSize.value.width})`};
  const width=Math.min(liveWidth.value,baseSize.value.width);
  return {width:`${width}px`,height:`${width*baseSize.value.height/baseSize.value.width}px`,transform:`scale(${Math.max(1,liveWidth.value/baseSize.value.width)})`};
});

function beginGesture(event: PointerEvent) {
  if(!editMode.value || event.button!==0 || gesture) return;
  event.preventDefault();
  editError.value='';
  const target=event.currentTarget as HTMLElement;
  const kind=(event.target as HTMLElement).closest<HTMLElement>('[data-corner]')?.dataset.corner as EditGesture | undefined;
  target.setPointerCapture(event.pointerId);
  const token=window.deskIsland.beginWidgetGesture(kind ?? 'move');
  gesture={pointerId:event.pointerId,target,token};
  dragging.value=true;
  // Attach rejection handling immediately, including quick clicks that end before IPC replies.
  void token.catch(error=>{editError.value=error instanceof Error?error.message:'无法开始编辑';if(gesture?.token===token) releaseGesture();});
}

function releaseGesture() {
  const current=gesture;
  gesture=null;
  dragging.value=false;
  if(current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
  return current;
}

async function finishGesture(commit: boolean, event?: PointerEvent) {
  if(event && event.pointerId!==gesture?.pointerId) return;
  const current=releaseGesture();
  if(!current) return;
  try {
    const updated=await window.deskIsland.endWidgetGesture(await current.token,commit);
    if(updated) widget.value=updated;
  } catch(error) { editError.value=error instanceof Error?error.message:'保存磁贴布局失败'; }
}
const selectedLocation = computed(() => {
  const value = widget.value?.settings.location;
  return value && typeof value === 'object' ? value as WeatherLocation : null;
});
const weatherLocationParts = computed(() => (weather.value?.location || [selectedLocation.value?.name, selectedLocation.value?.region?.replaceAll(' · ', ' ')].filter(Boolean).join(' ') || '正在读取地点…').split(/\s+/));
const currentPosition = computed(() => {
  positionPulse.value;
  const start = media.value?.positionTicks ?? 0;
  const elapsedTicks = media.value?.playbackStatus === 'Playing' && media.value.timelineAvailable !== false ? (Date.now() - observedMediaAt) * 10_000 : 0;
  return Math.min(media.value?.durationTicks ?? Number.MAX_SAFE_INTEGER, start + elapsedTicks);
});
const currentLyric = computed(() => activeLyric(lyrics.value?.lines ?? [], currentPosition.value / 10_000_000));
const lyricEndSeconds = computed(() => lyrics.value?.lines.find(line => line.timeSeconds > currentPosition.value / 10_000_000)?.timeSeconds ?? (media.value?.durationTicks ? media.value.durationTicks / 10_000_000 : undefined));

function stopTimers() {
  clearInterval(mediaTimer);
  clearInterval(positionTimer);
  mediaTimer = undefined;
  positionTimer = undefined;
}

function startTimers() {
  stopTimers();
  if (!widget.value) return;
  if (widget.value.typeId === 'music') {
    // A maximized foreground window may leave this tile visible; keep playback synchronized while occluded.
    const foreground = active.value && document.visibilityState === 'visible';
    void refreshMedia();
    mediaTimer = setInterval(() => void refreshMedia(), foreground ? 400 : 1000);
    positionTimer = setInterval(() => { positionPulse.value += 1; }, foreground ? 250 : 1000);
  }
}

async function loadWidget() {
  const all = await window.deskIsland.listWidgets();
  widget.value = all.find((item) => item.id === props.widgetId) ?? null;
  if (!widget.value) message.value = '找不到这个磁贴，请在主控台重新添加。';
  clearInterval(weatherTimer);
  weatherTimer = undefined;
  // Weather uses elapsed time even when an enabled desktop tile is occluded.
  if (widget.value?.typeId === 'weather' && widget.value.enabled && selectedLocation.value) {
    void refreshWeather();
    weatherTimer = setInterval(() => void refreshWeather(), 60 * 60 * 1000);
  }
  startTimers();
}

async function refreshMedia() {
  if (mediaRefreshing || commandPending.value || disposed) return;
  mediaRefreshing = true;
  const version = mediaVersion;
  try {
    const snapshot = await window.deskIsland.getMediaSnapshot();
    if (version !== mediaVersion || disposed) return;
    if (expectedPlayback) {
      if (snapshot.sourceId !== expectedPlayback.sourceId || snapshot.playbackStatus === expectedPlayback.status || Date.now() >= expectedPlayback.until) expectedPlayback = null;
      else snapshot.playbackStatus = expectedPlayback.status;
    }
    media.value = snapshot;
    observedMediaAt = Date.now();
    message.value = '';
    const nextKey = snapshot.available && snapshot.title && snapshot.artist
      ? JSON.stringify([snapshot.sourceId, snapshot.title, snapshot.artist, snapshot.album, snapshot.durationTicks])
      : '';
    if (nextKey !== lyricTrackKey) {
      lyricTrackKey = nextKey;
      lyrics.value = null;
      lyricsError.value = '';
      lyricRequestId++;
      lyricAttempts = 0;
      lyricRetryAt = 0;
      lyricsLoading.value = false;
    }
    if (nextKey && !lyrics.value?.lines.length && !lyricsLoading.value && lyricAttempts < 3 && Date.now() >= lyricRetryAt) {
        const requestId = ++lyricRequestId;
        lyricAttempts++;
        lyricsLoading.value = true;
        void window.deskIsland.getLyrics({
          title: snapshot.title!,
          artist: snapshot.artist!,
          album: snapshot.album,
          sourceId: snapshot.sourceId,
          durationSeconds: snapshot.durationTicks ? snapshot.durationTicks / 10_000_000 : undefined,
        }).then((result) => {
          if (result && 'error' in result) throw new Error(result.error);
          if (requestId === lyricRequestId && !disposed) {
            lyrics.value = result;
            lyricsError.value = '';
            // Plain fallback may follow a temporary QQ outage; retry without pretending it is synchronized.
            if (result && !result.lines.length) lyricRetryAt = Date.now() + 30_000;
            if (!result) lyricAttempts = 3;
          }
        }).catch((error: unknown) => {
          if (requestId === lyricRequestId && !disposed) {
            lyricsError.value = error instanceof Error ? error.message : '歌词查询失败';
            lyricRetryAt = Date.now() + lyricAttempts * 10_000;
          }
        }).finally(() => {
          if (requestId === lyricRequestId) lyricsLoading.value = false;
        });
    }
  } catch (error) {
    media.value = null;
    // A transient media read must not reset the same track's lyrics retry budget.
    if (lyricsLoading.value) lyricAttempts--;
    lyricRequestId++;
    lyricsLoading.value = false;
    expectedPlayback = null;
    message.value = error instanceof Error ? error.message : '读取播放状态失败';
  } finally { mediaRefreshing = false; }
}

async function sendMediaCommand(command: 'toggle' | 'next' | 'previous' | 'seek', position?: number) {
  if (commandPending.value || !media.value?.available || !media.value.sourceId) return;
  commandPending.value = true;
  mediaVersion++;
  const previous = media.value;
  try {
    const result = await window.deskIsland.sendMediaCommand(command, media.value.sourceId!, position);
    if (!result.accepted) throw new Error('播放器暂不支持此操作');
    if (command === 'toggle' && previous) {
      const positionTicks = currentPosition.value;
      const status = previous.playbackStatus === 'Playing' ? 'Paused' : 'Playing';
      media.value = { ...previous, positionTicks, playbackStatus: status };
      observedMediaAt = Date.now();
      expectedPlayback = { status, until: Date.now() + 1500, sourceId: previous.sourceId };
    }
    message.value = '';
  } catch (error) {
    message.value = error instanceof Error ? error.message : '音乐控制失败';
  } finally { commandPending.value = false; void refreshMedia(); }
}

async function refreshWeather() {
  if (!selectedLocation.value) return;
  const requestId=++weatherRequestId;
  message.value = '';
  try {
    const location = { ...selectedLocation.value };
    if (location.regionCodes) location.regionCodes = [...location.regionCodes];
    const snapshot=await window.deskIsland.getWeather(location);
    if(requestId===weatherRequestId) {weather.value=snapshot;message.value='';}
  } catch (error) {
    if(requestId===weatherRequestId) message.value = error instanceof Error ? error.message.replace(/^Error invoking remote method 'weather:get': (?:Error: )?/, '') : '读取天气失败，请重试';
  }
}

async function configureWeather() {
  try {
    await window.deskIsland.configureWeather();
  } catch (error) {
    message.value = error instanceof Error ? error.message : '打开地点设置失败';
  }
}

function handleActiveChange(isActive: boolean) {
  active.value = isActive;
  startTimers();
}

function handleVisibilityChange() {
  startTimers();
}

onMounted(async () => {
  removeSettingsListener=window.deskIsland.onWidgetSettingsChange(()=>{
    weatherRequestId++;weather.value=null;void loadWidget();
  });
  removeBoundsListener=window.deskIsland.onWidgetBounds(bounds=>{liveWidth.value=bounds.width;});
  removeCancelListener=window.deskIsland.onWidgetGestureCancelled(token=>{
    const current=gesture;
    if(current) void current.token.then(activeToken=>{
      if(activeToken===token && gesture===current) releaseGesture();
    }).catch(()=>{});
  });
  removeActiveListener = window.deskIsland.onWidgetActiveChange(handleActiveChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  removeEditListener = window.deskIsland.onEditModeChange(enabled => {
    editMode.value = enabled;
    if(!enabled) void finishGesture(false);
  });
  editMode.value = await window.deskIsland.getEditMode();
  await loadWidget();
});

onBeforeUnmount(() => {
  clearInterval(weatherTimer);
  disposed = true;
  lyricRequestId++;
  weatherRequestId++;
  removeSettingsListener?.();
  void finishGesture(false);
  removeBoundsListener?.();
  removeCancelListener?.();
  stopTimers();
  removeActiveListener?.();
  removeEditListener?.();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<template>
  <main v-if="widget" class="tile" :class="[`tile--${widget.typeId}`, { 'tile--editing': editMode }]">
    <div class="tile__content" :style="contentStyle" :inert="editMode">
    <MusicTile v-if="isMusic" :wide="widget.variantId === 'wide'" :compact="compact" :media="media" :position="currentPosition" :command-pending="commandPending" :animation-active="true"
      :lyric-line="media?.timelineAvailable === false ? undefined : currentLyric" :lyric-end-seconds="lyricEndSeconds" :lyric="media?.timelineAvailable === false ? '未提供播放时间，歌词同步不可用' : currentLyric?.text || (lyricsLoading ? '正在获取歌词…' : lyricsError ? lyricAttempts < 3 ? '正在重试歌词…' : '歌词暂时无法获取' : lyrics?.lines.length ? '等待歌词开始' : lyrics?.plainLyrics ? '暂无同步歌词' : lyricTrackKey ? '暂无匹配歌词' : '等待歌词')"
      @command="sendMediaCommand" />

    <SearchTile v-else-if="widget.typeId === 'desktop-search'" :width="liveWidth" />
    <AudioTile v-else-if="widget.typeId === 'audio'" />
    <CountdownTile v-else-if="widget.typeId === 'countdown'" :compact="compact" />
    <TodoTile v-else-if="widget.typeId === 'todo'" :items="widget.settings.items as TodoItem[]" :editing="editMode" @saved="items => { if(widget) widget.settings.items = items; }" />
    <section v-else class="weather" :class="{'weather--compact':compact}">
      <template v-if="selectedLocation">
        <button type="button" class="weather__place weather__configure" :title="weather?.attribution" aria-label="在主窗口更改天气地点及查看数据来源" @click="configureWeather"><span v-for="(part,index) in weatherLocationParts" :key="index">{{ part }}{{ index < weatherLocationParts.length-1 ? ' ' : '' }}</span></button>
        <template v-if="weather">
          <div class="weather__current"><p class="weather__temperature">{{ Math.round(weather.temperature) }}°</p><WeatherIcon :code="weather.weatherCode" :condition="weather.condition" /></div>
          <p class="weather__condition">{{ weather.condition }}<template v-if="!compact"> · 体感 {{ Math.round(weather.apparentTemperature) }}°</template></p>
          <p v-if="!compact" class="weather__range">最高 {{ weather.high ?? '—' }}°　最低 {{ weather.low ?? '—' }}°</p>
          <p v-if="weather.stale" class="weather__stale">显示缓存天气</p>
          <p v-if="weather.source" class="weather__source" :title="weather.attribution">来源：{{ weather.source }}</p>
        </template>
        <p v-else class="weather__loading">{{ message ? '天气暂时无法获取' : '正在读取天气…' }}</p>
        <button v-if="message" type="button" class="weather__configure" @click="refreshWeather">重试</button>
      </template>
      <template v-else>
        <p class="weather__prompt">设置一个地点</p>
        <button type="button" class="weather__configure" @click="configureWeather">在主窗口设置地点</button>
      </template>
    </section>
    </div>
    <div v-if="editMode" class="tile__editor" :class="{ 'tile__editor--dragging': dragging }"
      aria-label="编辑模式：整面拖动，四角缩放，Esc 完成编辑"
      @pointerdown="beginGesture" @pointerup="finishGesture(true,$event)"
      @pointercancel="finishGesture(false,$event)" @lostpointercapture="finishGesture(false,$event)" @contextmenu.prevent>
      <span v-for="corner in corners" :key="corner" :data-corner="corner" class="tile__corner" :class="`tile__corner--${corner}`" :aria-label="`从 ${corner} 角${widget.typeId === 'todo' ? '自由' : '等比'}缩放`"></span>
    </div>
    <p v-if="editError || message" class="tile__message" role="status">{{ editError || message }}</p>
  </main>
  <main v-else class="tile tile--error">{{ message || '正在加载磁贴…' }}</main>
</template>

<style>
.tile.tile--desktop-search{background:transparent;border:0;border-radius:0}
.tile--todo{background:#BEDAE4!important;border-color:transparent!important}
.weather--compact{padding:6px 12px!important}.weather--compact .weather__temperature{font-size:34px}.weather__place.weather__configure{min-height:28px}.weather--compact .weather__condition{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weather--compact .weather__stale{font-size:10px;margin-top:2px}
.weather__configure{background:#ffffff10;border:1px solid #ffffff26;border-radius:8px;color:inherit;padding:8px;cursor:pointer;text-align:left}.weather__place.weather__configure{padding:0;background:none;border:none;width:100%;max-width:100%;overflow:auto;white-space:normal;overflow-wrap:anywhere;scrollbar-width:none;line-height:1.35;flex-shrink:0}
*{box-sizing:border-box}body{font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color:#fafafa;color-scheme:dark}button,input{font:inherit}button:focus-visible,input:focus-visible{outline:2px solid #eee9ef;outline-offset:2px}
.tile{position:relative;width:100%;height:100%;overflow:hidden;border:1px solid #ffffff40;border-radius:20px;background:rgba(8,10,14,.34);-webkit-app-region:no-drag;user-select:none}
.tile--editing{border-color:#eee9ef}.tile__content{position:absolute;left:0;top:0;transform-origin:top left}.tile__editor{position:absolute;inset:0;z-index:2;cursor:grab;touch-action:none;-webkit-app-region:no-drag;background:#ffffff03}.tile__editor--dragging{cursor:grabbing}.tile__corner{position:absolute;width:28px;height:28px}.tile__corner::after{content:"";position:absolute;width:8px;height:8px;border:2px solid #eee9ef;border-radius:2px;inset:10px}.tile__corner--nw{left:0;top:0;cursor:nwse-resize}.tile__corner--ne{right:0;top:0;cursor:nesw-resize}.tile__corner--sw{left:0;bottom:0;cursor:nesw-resize}.tile__corner--se{right:0;bottom:0;cursor:nwse-resize}
.weather{padding:12px 19px;display:flex;height:100%;flex-direction:column;justify-content:center}.weather__place,.weather__prompt{margin:0 0 5px;color:#e6e2e6;font-size:12px}.weather__temperature{margin:0;font-size:44px;font-weight:350;line-height:1.1;letter-spacing:-.04em}.weather__condition,.weather__range{margin:5px 0 0;font-size:12px}.weather__range{color:#e6e2e6}.weather__stale,.weather small{margin:5px 0 0;color:#e6e2e6;font-size:10px}.weather__form{display:flex;gap:6px}.weather__form input{min-width:0;flex:1;border:1px solid #ffffff40;border-radius:8px;padding:7px;color:#fafafa;background:#ffffff10;user-select:text}.weather__form button,.weather__results button{border:0;border-radius:8px;padding:6px 9px;color:#fafafa;background:#ffffff14;cursor:pointer}.weather__results{max-height:86px;overflow:auto;margin:6px 0 0;padding:0;list-style:none}.weather__results button{width:100%;overflow:hidden;margin-top:3px;text-align:left;text-overflow:ellipsis;white-space:nowrap}.weather__loading{color:#e6e2e6;font-size:12px}
.tile__message{position:absolute;left:12px;right:12px;bottom:0;overflow:hidden;color:#ffc6aa;font-size:10px;white-space:nowrap;text-overflow:ellipsis;background:#17161be8;pointer-events:none}.tile--error{display:grid;place-items:center;color:#e6e2e6;font-size:12px}.no-drag{-webkit-app-region:no-drag}
.weather__current{display:flex;align-items:center;justify-content:space-between;gap:8px}.weather__place,.weather__prompt{font-size:16px}.weather__temperature{font-size:54px}.weather__condition,.weather__range{font-size:15px}.weather__stale,.weather__loading{font-size:13px}.weather--compact .weather__temperature{font-size:38px}.weather--compact .weather__place{font-size:14px}.weather--compact .weather__condition{font-size:14px}.weather--compact .weather__stale{font-size:12px}
.weather__place span{display:inline-block;white-space:pre}
.weather__source{font-size:10px;color:#e6e2e6;margin:2px 0 0}
</style>
