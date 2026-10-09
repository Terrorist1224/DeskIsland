<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ code: number; condition: string }>();
const kind = computed(() => {
  const code = props.code;
  if (code === 0 || code === 1) return 'sun';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  return 'unknown';
});
</script>

<template>
  <svg class="weather-icon" :data-weather="kind" viewBox="0 0 64 64" role="img" :aria-label="condition" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <g v-if="kind==='sun' || kind==='partly-cloudy'" stroke="#ffd67d">
      <circle cx="27" cy="26" r="11" fill="#ffd67d30" />
      <path d="M27 7v-4m0 46v-4M8 26H4m46 0h-4M13.5 12.5l-3-3m33 33-3-3m-27 0-3 3m33-33-3 3" />
    </g>
    <path v-if="!['sun','unknown'].includes(kind)" d="M17 43a10 10 0 0 1-1-20 14 14 0 0 1 27-1 10.5 10.5 0 1 1 3 21Z" fill="#e6edf338" stroke="#e6edf3" />
    <path v-if="kind==='rain'" d="m20 49-3 6m15-6-3 6m15-6-3 6" stroke="#9bd8ff" />
    <path v-if="kind==='snow'" d="M20 49v10m-4-8 8 6m0-6-8 6m26-8v10m-4-8 8 6m0-6-8 6" stroke="#c8e9ff" stroke-width="2" />
    <path v-if="kind==='storm'" d="m34 42-8 10h8l-6 9" stroke="#ffd67d" />
    <path v-if="kind==='fog'" d="M12 50h40M18 57h28" stroke="#d4dbe4" />
    <g v-if="kind==='unknown'"><circle cx="32" cy="32" r="21" /><path d="M26 25a6 6 0 0 1 12 0c0 5-6 5-6 10m0 8v1" /></g>
  </svg>
</template>

<style>
.weather-icon{width:64px;height:64px;flex:none}.weather--compact .weather-icon{width:42px;height:42px}
</style>
