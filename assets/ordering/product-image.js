import { prepareGalleryImage } from './gallery-image.js';

export const productImageAccept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

export async function prepareProductImage(file) {
  if (!(file instanceof File) || !file.size) throw new Error('Choose a photo to upload.');
  const heic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
  if (heic) return (await prepareGalleryImage(file)).file;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Use a JPEG, PNG, WebP, or HEIC/HEIF image.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('JPEG, PNG, and WebP images must be 5 MB or smaller.');
  return file;
}
