// Leave vertical scrolling and pinch zoom to the browser. Only a deliberate
// horizontal touch/pen gesture navigates; arrows and ordinary taps stay intact.
export function enablePhotoSwipe(element, step) {
  let gesture, suppressClick = false;
  element.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (!event.isPrimary) { gesture = null; return; }
    if (!['touch', 'pen'].includes(event.pointerType)) return;
    if (event.target.closest('button, a') && event.target.closest('button, a') !== element) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  element.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    gesture = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    suppressClick = true;
    step(dx < 0 ? 1 : -1);
  });
  element.addEventListener('pointercancel', () => { gesture = null; });
  element.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
