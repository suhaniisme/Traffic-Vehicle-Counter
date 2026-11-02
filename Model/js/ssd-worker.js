// Runs COCO-SSD (TensorFlow.js) off the main thread; same message protocol
// as detr-worker.js. TensorFlow.js uses WebGL through OffscreenCanvas here.
importScripts(
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'
);

let model = null;

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      if (!model) {
        await tf.ready();
        model = await cocoSsd.load({ base: 'mobilenet_v2' });
      }
      self.postMessage({ id, type: 'result' });
    } else if (type === 'detect') {
      const value = await model.detect(data.image, data.maxBoxes, data.minScore);
      self.postMessage({ id, type: 'result', value });
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e.message || String(e) });
  }
};
