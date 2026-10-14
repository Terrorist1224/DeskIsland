import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';

export function useListDrag<T extends { id: string }>(root: Ref<HTMLElement | undefined>, list: Ref<HTMLElement | undefined>, options: {
  items: () => T[]; blocked: () => boolean; busy: Ref<boolean>; error: Ref<string>;
  save: (id: string, beforeId: string | null) => Promise<T[]>; saved: (items: T[]) => void; onStart?: () => void;
}) {
  const ordered = shallowRef<T[] | null>(null);
  const displayed = computed(() => ordered.value ?? options.items());
  const dragging = shallowRef<T | null>(null);
  const dragTop = ref(0);
  const dragHeight = ref(0);
  const settling = ref(false);
  let gesture: { id: number; item: T; startY: number; y: number; offset: number } | undefined;
  let frame = 0;
  const suppressClick = ref(false);

  function cancelDrag() {
    cancelAnimationFrame(frame);
    if (gesture && root.value?.hasPointerCapture(gesture.id)) root.value.releasePointerCapture(gesture.id);
    gesture = undefined;dragging.value = null;ordered.value = null;settling.value = false;
    setTimeout(() => { suppressClick.value = false; }, 0);
  }
  function startDrag(event: PointerEvent, item: T) {
    if (event.button !== 0 || !event.isPrimary || options.blocked() || options.busy.value) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    gesture = { id: event.pointerId, item, startY: event.clientY, y: event.clientY, offset: event.clientY - bounds.top };
    dragHeight.value = bounds.height;
  }
  function moveDrag(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    gesture.y = event.clientY;
    if (!dragging.value && Math.abs(event.clientY - gesture.startY) >= 6) {
      root.value?.setPointerCapture(event.pointerId);
      ordered.value = [...options.items()];dragging.value = gesture.item;
      options.onStart?.();suppressClick.value = true;
      frame = requestAnimationFrame(dragFrame);
    }
    if (dragging.value) event.preventDefault();
  }
  function dragFrame() {
    if (!gesture || !dragging.value || !list.value || !root.value || !ordered.value) return;
    const bounds = list.value.getBoundingClientRect();
    // Edge scrolling is frame-based so a held pointer can reach rows outside the viewport.
    const edge = 28;
    const speed = gesture.y < bounds.top + edge ? -Math.min(10, (bounds.top + edge - gesture.y) / 3)
      : gesture.y > bounds.bottom - edge ? Math.min(10, (gesture.y - bounds.bottom + edge) / 3) : 0;
    list.value.scrollTop += speed;
    dragTop.value = Math.max(bounds.top, Math.min(gesture.y - gesture.offset, Math.max(bounds.top, bounds.bottom - dragHeight.value))) - root.value.getBoundingClientRect().top;
    const y = gesture.y - bounds.top + list.value.scrollTop;
    const rows = [...list.value.querySelectorAll<HTMLElement>('[data-list-id]')].filter(row => row.dataset.listId !== gesture!.item.id);
    const index = rows.filter(row => y > row.offsetTop + row.offsetHeight / 2).length;
    const current = ordered.value.findIndex(item => item.id === gesture!.item.id);
    if (index !== current) {
      const items = ordered.value.filter(item => item.id !== gesture!.item.id);
      items.splice(index, 0, gesture.item);ordered.value = items;
    }
    frame = requestAnimationFrame(dragFrame);
  }
  async function endDrag(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!dragging.value || !ordered.value) { gesture = undefined;return; }
    const itemId = gesture.item.id;
    const index = ordered.value.findIndex(item => item.id === itemId);
    const beforeId = ordered.value[index + 1]?.id ?? null;
    const changed = ordered.value.some((item, index) => item.id !== options.items()[index]?.id);
    cancelAnimationFrame(frame);
    if (root.value?.hasPointerCapture(gesture.id)) root.value.releasePointerCapture(gesture.id);
    gesture = undefined;
    setTimeout(() => { suppressClick.value = false; }, 0);
    options.busy.value = true;options.error.value = '';
    settling.value = true;
    const row = [...(list.value?.querySelectorAll<HTMLElement>('[data-list-id]') ?? [])].find(row => row.dataset.listId === itemId);
    if (row && list.value && root.value) dragTop.value = row.offsetTop - list.value.scrollTop + list.value.getBoundingClientRect().top - root.value.getBoundingClientRect().top;
    try {
      const [items] = await Promise.all([
        changed ? options.save(itemId, beforeId) : Promise.resolve(options.items()),
        new Promise(resolve => setTimeout(resolve, 180)),
      ]);
      if (changed) options.saved(items);
      await nextTick();
    }
    catch (cause) { options.error.value = cause instanceof Error ? cause.message : '排序保存失败，请重试'; }
    finally { ordered.value = null;dragging.value = null;settling.value = false;options.busy.value = false; }
  }
  watch(options.items, () => { if (gesture) cancelDrag(); });
  onBeforeUnmount(cancelDrag);
  return { displayed, dragging, dragTop, dragHeight, settling, suppressClick, cancelDrag, startDrag, moveDrag, endDrag, lostCapture: () => { if (gesture) cancelDrag(); } };
}
