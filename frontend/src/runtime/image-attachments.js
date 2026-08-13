const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const droppedImageFiles = new WeakMap();
const imagePreviewUrls = new WeakMap();

function imageMimeType(file) {
  const type = String(typeof file === 'string' ? file : file?.type || '').toLowerCase();
  if (type && type !== 'application/octet-stream') return type === 'image/jpg' ? 'image/jpeg' : type;
  const extension = String(file?.name || '').match(/\.([^.]+)$/)?.[1].toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })[extension] || type;
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error || new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

export function imageAttachmentText(prompt, count) {
  return count ? `${prompt}\n\n[${count} image${count === 1 ? '' : 's'} attached]` : prompt;
}

export function imageAttachmentSrc(image = {}) {
  const mimeType = imageMimeType(image.mimeType || image.mediaType || image.type);
  const data = String(image.data || image.source?.data || '').replace(/^data:[^,]+,/i, '').replace(/\s/g, '');
  if (!IMAGE_MIME_TYPES.has(mimeType) || !data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return '';
  return `data:${mimeType};base64,${data}`;
}

export function imageInputFiles(input) {
  return [...Array.from(input?.files || []), ...(droppedImageFiles.get(input) || [])];
}

export function clearImageInput(input) {
  if (!input) return;
  input.value = '';
  droppedImageFiles.delete(input);
}

function imageCountText(count) {
  return `${count} image${count === 1 ? '' : 's'} added`;
}

function clearNode(node) {
  if (typeof node.replaceChildren === 'function') node.replaceChildren();
  else node.textContent = '';
}

function revokeImagePreviewUrls(node) {
  const urls = imagePreviewUrls.get(node) || [];
  for (const url of urls) {
    try { globalThis.URL?.revokeObjectURL?.(url); } catch {}
  }
  imagePreviewUrls.delete(node);
}

function previewBlobForFile(file) {
  const mimeType = imageMimeType(file);
  if (!IMAGE_MIME_TYPES.has(mimeType) || file?.type === mimeType) return file;
  return typeof file?.slice === 'function' ? file.slice(0, file.size, mimeType) : file;
}

function objectUrlForFile(file) {
  try { return globalThis.URL?.createObjectURL?.(previewBlobForFile(file)) || ''; } catch { return ''; }
}

function renderImagePreviewTile(doc, file, urls) {
  const tile = doc.createElement('span');
  tile.className = 'attachment-preview';
  tile.title = file?.name || 'attached image';
  const src = objectUrlForFile(file);
  if (!src) {
    tile.className += ' is-fallback';
    tile.textContent = 'img';
    return tile;
  }

  urls.push(src);
  const img = doc.createElement('img');
  img.src = src;
  img.alt = '';
  img.setAttribute?.('aria-hidden', 'true');
  tile.append(img);
  return tile;
}

export function updateImageStatus(input, node) {
  if (!input || !node) return;
  const files = imageInputFiles(input);
  const count = files.length;
  const text = count ? imageCountText(count) : '';
  revokeImagePreviewUrls(node);
  clearNode(node);
  node.title = count ? files.map((file) => file?.name).filter(Boolean).join(', ') : '';
  node.setAttribute?.('aria-label', text);
  if (!count) node.removeAttribute?.('aria-label');
  node.classList?.toggle('has-images', count > 0);
  node.classList?.toggle('muted', count === 0);
  if (!count) return;

  const doc = node.ownerDocument || globalThis.document;
  if (!doc?.createElement || typeof node.append !== 'function') {
    node.textContent = `✓ ${text}`;
    return;
  }

  const label = doc.createElement('span');
  label.className = 'sr-only';
  label.textContent = text;
  node.append(label);

  const urls = [];
  const visibleFiles = files.slice(0, count > MAX_IMAGES ? MAX_IMAGES - 1 : MAX_IMAGES);
  for (const file of visibleFiles) node.append(renderImagePreviewTile(doc, file, urls));
  if (count > visibleFiles.length) {
    const more = doc.createElement('span');
    more.className = 'attachment-preview attachment-preview-more';
    more.textContent = `+${count - visibleFiles.length}`;
    node.append(more);
  }
  imagePreviewUrls.set(node, urls);
}

export function acceptedImageFiles(files) {
  return Array.from(files || []).filter((file) => file?.size > 0 && IMAGE_MIME_TYPES.has(imageMimeType(file)));
}

function hasFileDrag(dataTransfer) {
  return Array.from(dataTransfer?.types || []).some((type) => String(type).toLowerCase() === 'files')
    || Array.from(dataTransfer?.items || []).some((item) => item?.kind === 'file')
    || Array.from(dataTransfer?.files || []).length > 0;
}

function createDataTransfer() {
  if (typeof DataTransfer !== 'function') return null;
  try {
    return new DataTransfer();
  } catch {
    return null;
  }
}

function appendImageFiles(input, files) {
  const accepted = acceptedImageFiles(files);
  if (!accepted.length) return 0;

  const dropped = droppedImageFiles.get(input) || [];
  const transfer = createDataTransfer();
  if (transfer) {
    try {
      for (const file of Array.from(input.files || [])) transfer.items.add(file);
      for (const file of dropped) transfer.items.add(file);
      for (const file of accepted) transfer.items.add(file);
      input.files = transfer.files;
      droppedImageFiles.delete(input);
    } catch {
      droppedImageFiles.set(input, [...dropped, ...accepted]);
    }
  } else {
    droppedImageFiles.set(input, [...dropped, ...accepted]);
  }
  return accepted.length;
}

function clipboardImageFiles(dataTransfer) {
  const files = acceptedImageFiles(dataTransfer?.files);
  if (files.length) return files;

  return acceptedImageFiles(Array.from(dataTransfer?.items || [], (item) => {
    if (!String(item?.type || '').toLowerCase().startsWith('image/')) return null;
    return typeof item.getAsFile === 'function' ? item.getAsFile() : null;
  }).filter(Boolean));
}

export function bindImageDropZone(zone, input, statusNode) {
  if (!zone || !input) return;
  input.addEventListener?.('change', () => droppedImageFiles.delete(input), { capture: true });

  let dragDepth = 0;
  const setActive = (active) => zone.classList.toggle('is-dragging-images', active);

  zone.addEventListener('dragenter', (event) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
    setActive(true);
  });

  zone.addEventListener('dragover', (event) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
  });

  zone.addEventListener('dragleave', (event) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      setActive(false);
    }
  });

  zone.addEventListener('drop', (event) => {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth = 0;
    setActive(false);

    appendImageFiles(input, event.dataTransfer.files);
    updateImageStatus(input, statusNode);
  });

  zone.addEventListener('paste', (event) => {
    const files = clipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    appendImageFiles(input, files);
    updateImageStatus(input, statusNode);
  });
}

export async function filesToImageAttachments(files) {
  const selected = Array.from(files || []).filter((file) => file.size > 0);
  if (selected.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} images.`);

  return Promise.all(selected.map(async (file) => {
    const mimeType = imageMimeType(file);
    if (!IMAGE_MIME_TYPES.has(mimeType)) throw new Error('Images must be PNG, JPEG, GIF, or WebP.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Each image must be 8MB or smaller.');

    const dataUrl = await readDataUrl(file);
    const comma = dataUrl.indexOf(',');
    if (comma === -1) throw new Error(`Could not read ${file.name}.`);
    return { type: 'image', mimeType, data: dataUrl.slice(comma + 1) };
  }));
}
