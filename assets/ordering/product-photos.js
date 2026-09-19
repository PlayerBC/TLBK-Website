export function renderProductPhotos(photos, { escapeHtml: esc, safeImage, disabled = false }) {
  return `<div class="photo-list" role="list" aria-label="Product photo order">${photos.map((photo, index) => `<div class="photo-tile" role="listitem" data-photo-index="${index}"><button type="button" class="photo-reorder" data-photo-move="${index}" aria-label="Move photo ${index + 1}, position ${index + 1} of ${photos.length}${index === 0 ? ', menu cover' : ''}" aria-describedby="photo-order-help" ${disabled || photos.length < 2 ? 'disabled' : ''}><img src="${esc(safeImage(photo))}" alt="Product photo ${index + 1}" draggable="false"><span class="photo-grip" aria-hidden="true">⠿</span></button><span class="photo-position" aria-hidden="true">${index === 0 ? 'Cover' : index + 1}</span><button type="button" class="icon-button photo-remove" data-action="remove-photo" data-index="${index}" aria-label="Remove photo ${index + 1}" ${disabled ? 'disabled' : ''}>×</button></div>`).join('')}</div>`;
}

// One pointer interaction covers mouse, pen and touch. The draft changes only
// after a valid drop; Escape, pointer cancellation and outside drops are inert.
export function bindProductPhotoOrder(list, { canMove, onMove }) {
  let drag = null;
  let scrollFrame = 0;
  const tiles = () => [...list.querySelectorAll('[data-photo-index]')];
  const buttonFor = event => event.target.closest('[data-photo-move]');

  function clear() {
    const previous = drag;
    drag = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    previous?.ghost?.remove();
    tiles().forEach(tile => tile.classList.remove('photo-dragging', 'photo-drop-target'));
    if (previous?.button.hasPointerCapture(previous.pointerId)) previous.button.releasePointerCapture(previous.pointerId);
    return previous;
  }

  function targetAt(x, y) {
    const hit = list.ownerDocument.elementFromPoint(x, y);
    const tile = hit?.closest('[data-photo-index]');
    if (tile && list.contains(tile)) return Number(tile.dataset.photoIndex);
    if (hit !== list) return null;
    // Small gaps between thumbnails are valid drop areas too.
    const nearest = tiles().map(tile => {
      const rect = tile.getBoundingClientRect();
      return {index: Number(tile.dataset.photoIndex), distance: Math.hypot(x - rect.x - rect.width / 2, y - rect.y - rect.height / 2)};
    }).sort((a, b) => a.distance - b.distance)[0];
    return nearest?.index ?? null;
  }

  function previewTarget() {
    const index = targetAt(drag.x, drag.y);
    tiles().forEach(tile => tile.classList.toggle('photo-drop-target', Number(tile.dataset.photoIndex) === index && index !== drag.from));
  }

  function autoScroll() {
    if (!drag?.ghost) return;
    if (!list.isConnected || !canMove()) { clear(); return; }
    const dialog = list.closest('dialog');
    if (dialog) {
      const rect = dialog.getBoundingClientRect();
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      if (drag.x >= rect.left && drag.x <= rect.right && drag.y >= top && drag.y <= bottom) {
        if (drag.y < top + 48) dialog.scrollTop -= 12;
        else if (drag.y > bottom - 48) dialog.scrollTop += 12;
        previewTarget();
      }
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  list.addEventListener('pointerdown', event => {
    const button = buttonFor(event);
    if (drag || !event.isPrimary || event.button !== 0 || !button || button.disabled || !canMove()) return;
    const rect = button.getBoundingClientRect();
    drag = { button, pointerId: event.pointerId, from: Number(button.dataset.photoMove),
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height, ghost: null };
    button.focus({ preventScroll: true });
    button.setPointerCapture(event.pointerId);
  });

  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!canMove()) { clear(); return; }
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.ghost && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.ghost) {
      drag.ghost = drag.button.querySelector('img').cloneNode();
      drag.ghost.className = 'photo-drag-preview';
      drag.ghost.alt = '';
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.style.width = `${drag.width}px`;
      drag.ghost.style.height = `${drag.height}px`;
      // Keep the preview inside the dialog's top layer.
      (list.closest('dialog') || list).append(drag.ghost);
      drag.button.closest('[data-photo-index]').classList.add('photo-dragging');
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    drag.ghost.style.left = `${drag.x - drag.offsetX}px`;
    drag.ghost.style.top = `${drag.y - drag.offsetY}px`;
    previewTarget();
  });

  list.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const to = targetAt(event.clientX, event.clientY);
    const previous = clear();
    if (previous.ghost && to !== null && to !== previous.from && canMove()) {
      event.preventDefault();
      onMove(previous.from, to);
    }
  });
  for (const name of ['pointercancel', 'lostpointercapture']) list.addEventListener(name, event => {
    if (drag?.pointerId === event.pointerId) clear();
  });
  list.addEventListener('dragstart', event => event.preventDefault());
  list.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); clear(); return; }
    const button = buttonFor(event);
    if (!button || button.disabled || !canMove() || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const from = Number(button.dataset.photoMove), last = tiles().length - 1;
    const destination = { ArrowLeft: from - 1, ArrowUp: from - 1, ArrowRight: from + 1, ArrowDown: from + 1, Home: 0, End: last };
    if (!Object.hasOwn(destination, event.key)) return;
    event.preventDefault();
    const to = Math.max(0, Math.min(last, destination[event.key]));
    if (to !== from) onMove(from, to);
  });
  return clear;
}
