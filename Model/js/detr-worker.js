// Runs DETR ResNet-50 (Transformers.js) off the main thread. Inference takes
// seconds of solid CPU work; doing it on the page's thread freezes the UI.
//
// Messages in:  { id, type: 'load' }
//               { id, type: 'detect', image: ImageData, minScore }
// Messages out: { type: 'progress', progress }             (model download)
//               { id, type: 'result', value }               (predictions for 'detect')
//               { id, type: 'error', message }
import { pipeline, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

let detector = null;

// ImageData is RGBA; the model expects RGB.
function toRawImage(image) {
  const { width, height, data } = image;
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return new RawImage(rgb, width, height, 3);
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      detector = detector || await pipeline('object-detection', 'Xenova/detr-resnet-50', {
        dtype: 'q8',
        progress_callback: progress => self.postMessage({ type: 'progress', progress }),
      });
      self.postMessage({ id, type: 'result' });
    } else if (type === 'detect') {
      const value = await detector(toRawImage(data.image), { threshold: data.minScore, percentage: false });
      self.postMessage({ id, type: 'result', value });
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e.message || String(e) });
  }
};
