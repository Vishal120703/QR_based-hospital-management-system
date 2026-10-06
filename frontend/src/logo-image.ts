// Logo images are normalised in the browser before upload: any common format
// (PNG, JPEG, WebP, SVG) is drawn onto a canvas and saved as a PNG of at most
// 512 px on its longest side. That keeps uploads small, strips photo metadata,
// and means the server never stores SVG.

export const logoMaxSide = 512;
export const acceptedLogoTypes = 'image/png,image/jpeg,image/webp,image/svg+xml';

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This file could not be read as an image.'));
    image.src = source;
  });
}

function draw(image: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('This image has no size. Try a PNG or JPEG file.');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot process images here.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function prepareLogo(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!acceptedLogoTypes.split(',').includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, or SVG image.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const canvas = draw(await loadImage(url), logoMaxSide);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('This image could not be converted.');
    if (blob.size > 1024 * 1024) {
      throw new Error('This logo is still larger than 1 MB. Try a simpler image.');
    }
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The current logo as a PNG data URL with its size, for the PDF labels.
export async function logoForPdf(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const canvas = draw(await loadImage(url), 600);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}
