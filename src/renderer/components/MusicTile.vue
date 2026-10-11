<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import qqMusicIcon from '../assets/qq-music.png';
import type { LyricLine, MediaCommand, MediaSnapshot } from '../../shared/contracts';

const props = defineProps<{
  wide?: boolean;
  preview?: boolean;
  compact?: boolean;
  commandPending?: boolean;
  media: MediaSnapshot | null;
  lyric?: string;
  lyricLine?: LyricLine;
  lyricEndSeconds?: number;
  animationActive?: boolean;
  position: number;
}>();
const emit = defineEmits<{ command: [command: MediaCommand, position?: number] }>();
const supported = computed(() => props.preview || !!(props.media?.available && /^QQMusic\.exe$/i.test(props.media.sourceId ?? '')));
const seekable = computed(() => supported.value && props.media?.canSeek && (props.media.durationTicks ?? 0) > 0);
const lyricViewport = ref<HTMLElement>();
const lyricTrack = ref<HTMLElement>();
let lineStart = props.position / 10_000_000;
let resizeObserver: ResizeObserver | undefined;
let lyricAnimation: Animation | undefined;
function syncAnimation() {
  if (!lyricAnimation) return;
  const expected = Math.max(0, (props.position / 10_000_000 - lineStart) * 1000);
  // Native animation runs between media samples; correct seeks, not harmless sampling jitter.
  if (Math.abs(Number(lyricAnimation.currentTime ?? 0) - expected) > 100) lyricAnimation.currentTime = expected;
  if (props.media?.playbackStatus === 'Playing' && props.animationActive !== false && !document.hidden && !props.preview) {
    if (lyricAnimation.playState !== 'finished') lyricAnimation.play();
  } else lyricAnimation.pause();
}
function updateScroll() {
  const viewport = lyricViewport.value;
  const track = lyricTrack.value;
  if (!viewport || !track) return;
  lyricAnimation?.cancel();
  lyricAnimation = undefined;
  viewport.scrollLeft = 0;
  const distance = Math.max(0, track.scrollWidth - viewport.clientWidth);
  if (!distance || !supported.value) return;
  const duration = props.lyricEndSeconds && props.lyricEndSeconds - lineStart > 1 ? props.lyricEndSeconds - lineStart : distance / 24 + 2;
  const hold = Math.min(.2, .5 / duration);
  lyricAnimation = track.animate([
    { transform: 'translate3d(0,0,0)', offset: 0 },
    { transform: 'translate3d(0,0,0)', offset: hold },
    { transform: `translate3d(${-distance}px,0,0)`, offset: 1 - hold },
    { transform: `translate3d(${-distance}px,0,0)`, offset: 1 },
  ], { duration: duration * 1000, fill: 'both', easing: 'linear' });
  lyricAnimation.currentTime = Math.max(0, (props.position / 10_000_000 - lineStart) * 1000);
  syncAnimation();
}
watch(() => [props.lyric, props.lyricLine, props.media?.sourceId, props.media?.title], async () => {
  lineStart = props.lyricLine?.timeSeconds ?? props.position / 10_000_000;
  if (lyricViewport.value) lyricViewport.value.scrollLeft = 0;
  await nextTick();
  updateScroll();
});
watch(() => props.position, (position, previous) => {
  if (position < previous || position - previous > 20_000_000) lineStart = props.lyricLine?.timeSeconds ?? position / 10_000_000;
  syncAnimation();
});
watch(() => [props.media?.playbackStatus, props.animationActive], syncAnimation);
onMounted(() => { resizeObserver = new ResizeObserver(updateScroll); if (lyricViewport.value) resizeObserver.observe(lyricViewport.value); document.addEventListener('visibilitychange', syncAnimation); updateScroll(); });
onBeforeUnmount(() => { resizeObserver?.disconnect(); lyricAnimation?.cancel(); document.removeEventListener('visibilitychange', syncAnimation); });
const platform = computed(() => {
  if (props.preview) return '音乐平台 · 示例';
  const source = props.media?.sourceId ?? '';
  if (/qqmusic|qq\.music/i.test(source)) return 'QQ音乐';
  return '音乐';
});
function formatTime(ticks: number) {
  const seconds = Math.max(0, Math.floor(ticks / 10_000_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
</script>

<template>
  <section class="music-face" :class="{ 'music-face--wide': wide, 'music-face--compact': compact, 'music-face--seekable': seekable, 'music-face--empty': !supported }">
    <div class="music-platform" :title="platform" :aria-label="platform"><img v-if="/QQ音乐/.test(platform)" :src="qqMusicIcon" alt="QQ音乐" /><svg v-else viewBox="0 0 24 24" role="img" :aria-label="platform" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></svg><span v-if="preview">示例</span></div>
    <div class="music-layout">
      <div class="music-cover" aria-label="专辑封面">
        <img v-if="supported && media?.thumbnailDataUrl" :src="media.thumbnailDataUrl" alt="歌曲封面" draggable="false" />
        <div v-else class="music-cover__record" role="img" aria-label="黑胶唱片"><span></span></div>
      </div>
      <div class="music-details">
        <p class="music-title" :title="supported ? media?.title : undefined">{{ supported && media?.title || '等待歌曲' }}</p>
        <p class="music-artist">{{ supported && media?.artist || '等待歌手' }}</p>
      </div>
      <p ref="lyricViewport" class="music-lyric" :title="supported ? lyric : '等待歌词'" tabindex="0" aria-label="歌词"><span ref="lyricTrack" class="music-lyric__track">{{ supported && lyric || '等待歌词' }}</span></p>
      <div class="music-controls">
          <button type="button" aria-label="上一首" :disabled="preview || commandPending || !supported || !media?.canPrevious" @click="emit('command', 'previous')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h2v14H5zm3 7 11-7v14z" /></svg></button>
          <button type="button" class="music-play" :aria-label="media?.playbackStatus === 'Playing' ? '暂停' : '播放'" :disabled="preview || commandPending || !supported || !media?.canToggle" @click="emit('command', 'toggle')"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="media?.playbackStatus === 'Playing'" d="M7 5h4v14H7zm6 0h4v14h-4z" /><path v-else d="m7 4 14 8-14 8z" /></svg></button>
          <button type="button" aria-label="下一首" :disabled="preview || commandPending || !supported || !media?.canNext" @click="emit('command', 'next')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5h2v14h-2zM5 5l11 7-11 7z" /></svg></button>
      </div>
    </div>
    <div v-if="seekable" class="music-seek">
            <input type="range" aria-label="播放进度" min="0" :max="media?.durationTicks || 0" :value="position"
              title="播放进度"
              :disabled="preview || !media?.canSeek || !media?.durationTicks"
              @change="emit('command', 'seek', Number(($event.target as HTMLInputElement).value))" />
            <div v-if="wide"><span>{{ formatTime(position) }}</span><span>{{ formatTime(media?.durationTicks || 0) }}</span></div>
          </div>
  </section>
</template>

<style>
.music-face{height:100%;position:relative;isolation:isolate;overflow:hidden;padding:14px;user-select:none;color:#fafafa;display:flex;flex-direction:column}
.music-platform{flex:none;height:20px;line-height:20px;margin-bottom:6px;color:#e6e2e6;font-size:12px;white-space:nowrap;overflow:hidden;display:flex;align-items:center;gap:6px}.music-platform img,.music-platform svg{width:20px;height:20px;object-fit:contain;flex:none}.music-platform span{font-size:11px}
.music-layout{flex:1;min-height:0;display:grid;grid-template-columns:100px minmax(0,1fr);grid-template-rows:100px minmax(0,1fr) 32px;gap:8px 12px}
.music-cover{min-height:0;overflow:hidden;border-radius:9px;aspect-ratio:1}.music-cover img,.music-cover__placeholder{width:100%;height:100%;object-fit:cover}.music-cover__placeholder{display:grid;place-items:center;background:#ffffff14;color:#e6e2e6;font-size:11px}
.music-details{min-width:0;min-height:0;align-self:center}.music-title,.music-artist{margin:0;overflow:auto;scrollbar-width:none;overflow-wrap:anywhere}.music-title{font-size:20px;font-weight:600;line-height:1.25;max-height:2.5em}.music-artist{font-size:14px;color:#e6e2e6;margin-top:5px;line-height:1.4;max-height:4.2em}.music-lyric{grid-column:1/-1;min-height:0;margin:0;font-size:14px;line-height:18px;overflow:auto;white-space:normal;overflow-wrap:anywhere;scrollbar-width:none}
.music-controls{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:12px}.music-controls button{display:grid;place-items:center;flex:none;border:0;padding:0;background:#ffffff14;color:#fafafa;width:32px;height:32px;border-radius:50%;cursor:pointer}.music-controls svg{width:15px;height:15px;fill:currentColor}.music-controls .music-play{background:#efedf1;color:#262329}.music-controls button:disabled{opacity:.45;cursor:default}.music-controls button:focus-visible{outline:2px solid #eee9ef;outline-offset:2px}
.music-seek{flex:none;margin-top:4px}.music-seek input{display:block;width:100%;height:20px;margin:0;accent-color:#eee9ef}.music-seek>div{display:flex;justify-content:space-between;font-size:10px;color:#e6e2e6}
.music-face--seekable .music-layout{grid-template-columns:88px minmax(0,1fr);grid-template-rows:88px minmax(0,1fr) 32px}
.music-face--wide .music-layout{grid-template-columns:158px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) 32px;column-gap:16px}.music-face--wide .music-cover{grid-row:1/-1;align-self:center;width:100%;max-height:100%}.music-face--wide .music-lyric,.music-face--wide .music-controls{grid-column:2}.music-face--wide .music-title{font-size:22px}.music-face--wide .music-controls{justify-content:flex-start}
.music-face--wide.music-face--seekable:not(.music-face--compact) .music-layout{grid-template-columns:122px minmax(0,1fr)}
.music-face--compact{padding:10px}.music-face--compact .music-platform{height:16px;line-height:16px;margin-bottom:5px}.music-face--compact .music-platform img,.music-face--compact .music-platform svg{width:16px;height:16px}
.music-face--compact .music-layout{grid-template-columns:50px minmax(0,1fr);grid-template-rows:50px minmax(0,1fr) 24px;gap:4px 8px}.music-face--compact .music-title{font-size:16px;max-height:1.25em}.music-face--compact .music-artist{font-size:12px;line-height:1.3;margin-top:3px;max-height:1.3em}.music-face--compact .music-lyric{font-size:13px;line-height:17px}.music-face--compact .music-controls{gap:10px}.music-face--compact .music-controls button{width:24px;height:24px}
.music-face--compact .music-seek{margin-top:2px}.music-face--compact .music-seek input{height:12px}.music-face--compact .music-seek>div{display:none}
.music-face--compact.music-face--seekable .music-layout{grid-template-columns:40px minmax(0,1fr);grid-template-rows:40px minmax(0,1fr) 24px}
.music-face--compact.music-face--wide .music-layout{grid-template-columns:84px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) 24px;column-gap:10px}.music-face--compact.music-face--wide .music-artist{white-space:nowrap}
.music-face--compact.music-face--wide.music-face--seekable .music-platform{position:absolute;left:10px;top:10px}.music-face--compact.music-face--wide.music-face--seekable .music-layout{grid-template-columns:56px minmax(0,1fr);row-gap:2px}.music-face--compact.music-face--wide.music-face--seekable .music-cover{width:40px;align-self:end}
</style>

<style>
.music-cover__record{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 38% 30%,#ffffff24,transparent 42%),repeating-radial-gradient(circle,#111214 0px,#111214 2px,#292a2e 3px,#131416 4px);border:1px solid #ffffff20;box-shadow:0 3px 12px #0005}.music-cover__record span{width:30%;height:30%;border-radius:50%;background:radial-gradient(circle,#08090b 0 9%,#c4bdb0 10% 15%,#777268 16% 68%,#a8a197 69%);box-shadow:0 0 0 1px #0008}.music-cover:has(.music-cover__record){overflow:visible}.music-face--empty .music-title{color:#eee}.music-face--empty .music-artist,.music-face--empty .music-lyric{color:#b8b7bd}.music-lyric{overflow-x:auto;overflow-y:hidden;white-space:nowrap;overflow-wrap:normal;align-self:center;min-width:0;padding-block:2px;line-height:20px;position:relative}.music-lyric__track{display:inline-block;white-space:pre;position:relative}.preview-weather{position:relative}.preview-weather>div{align-items:center;min-height:18px;padding-right:48px}.preview-weather .weather-icon{position:absolute;right:16px;top:32px;width:42px;height:42px}
</style>
