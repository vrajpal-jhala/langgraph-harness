<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  poster: string;
  src: string;
  label?: string;
  alt?: string;
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
const started = ref(false);
const isPlaying = ref(false);
const isMuted = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const isBuffering = ref(false);
const controlsVisible = ref(true);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function showControls() {
  controlsVisible.value = true;
  clearTimeout(hideTimer);
  if (isPlaying.value) {
    hideTimer = setTimeout(() => (controlsVisible.value = false), 2000);
  }
}

function start() {
  started.value = true;
  // wait for the video element to mount before calling play()
  requestAnimationFrame(() => videoEl.value?.play());
}

function togglePlay() {
  const video = videoEl.value;
  if (!video) return;
  video.paused ? video.play() : video.pause();
}

function toggleMute() {
  const video = videoEl.value;
  if (!video) return;
  video.muted = !video.muted;
  isMuted.value = video.muted;
}

function toggleFullscreen() {
  videoEl.value?.requestFullscreen();
}

function onLoadedMetadata() {
  duration.value = videoEl.value?.duration ?? 0;
}

function onTimeUpdate() {
  currentTime.value = videoEl.value?.currentTime ?? 0;
}

function onSeek(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  currentTime.value = value;
  if (videoEl.value) videoEl.value.currentTime = value;
}

function onWaiting() {
  isBuffering.value = true;
}

function onPlaying() {
  isBuffering.value = false;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>

<template>
  <div class="screencast" @mousemove="started && showControls()">
    <img
      :src="poster"
      :alt="alt ?? 'Screencast preview'"
      class="screencast-media"
    />

    <video
      v-show="started"
      ref="videoEl"
      :src="src"
      preload="none"
      class="screencast-media screencast-media--video"
      @click="togglePlay"
      @play="
        isPlaying = true;
        showControls();
      "
      @pause="
        isPlaying = false;
        showControls();
      "
      @ended="
        isPlaying = false;
        showControls();
      "
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @waiting="onWaiting"
      @stalled="onWaiting"
      @seeking="onWaiting"
      @playing="onPlaying"
      @canplay="onPlaying"
      @seeked="onPlaying"
    />

    <button
      v-if="!started"
      type="button"
      class="screencast-play"
      aria-label="Play video"
      @click="start"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    </button>

    <div v-if="!started && label" class="screencast-caption">{{ label }}</div>

    <div
      v-if="started && isBuffering"
      class="screencast-buffering"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="32" height="32">
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-dasharray="47 90"
        />
      </svg>
    </div>

    <!-- ponytail: controls stay visible once started; add auto-hide-on-idle if the bar gets distracting -->
    <div v-if="started" class="screencast-controls">
      <button
        type="button"
        class="screencast-btn"
        :aria-label="isPlaying ? 'Pause' : 'Play'"
        @click="togglePlay"
      >
        <svg
          v-if="isPlaying"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>

      <input
        type="range"
        class="screencast-seek"
        min="0"
        :max="duration || 0"
        step="0.01"
        :value="currentTime"
        aria-label="Seek"
        @input="onSeek"
      />

      <span class="screencast-time"
        >{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span
      >

      <button
        type="button"
        class="screencast-btn"
        :aria-label="isMuted ? 'Unmute' : 'Mute'"
        @click="toggleMute"
      >
        <svg
          v-if="isMuted"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <path
            d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
          />
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <path
            d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
          />
        </svg>
      </button>

      <button
        type="button"
        class="screencast-btn"
        aria-label="Fullscreen"
        @click="toggleFullscreen"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path
            d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.screencast {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 1854 / 926;
  background-color: var(--vp-c-bg-soft);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.06),
    0 10px 24px rgba(0, 0, 0, 0.07);
}

.screencast-media {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.screencast-media--video {
  position: absolute;
  inset: 0;
  height: 100%;
  cursor: pointer;
}

.screencast-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  background-color: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  cursor: pointer;
  transition: background-color 0.15s;
}

.screencast-play:hover {
  background-color: var(--vp-c-brand-1);
}

.screencast-play svg {
  margin-left: 3px;
}

.screencast-buffering {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: white;
  background-color: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.screencast-buffering svg {
  animation: screencast-spin 0.8s linear infinite;
}

@keyframes screencast-spin {
  to {
    transform: rotate(360deg);
  }
}

.screencast-caption {
  position: absolute;
  left: 14px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: white;
  background-color: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.screencast-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
}

.screencast-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  color: white;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s;
}

.screencast-btn:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.screencast-seek {
  flex: 1;
  height: 4px;
  accent-color: var(--vp-c-brand-1);
  cursor: pointer;
}

.screencast-time {
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.85);
}
</style>
