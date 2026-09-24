// Browser implementation of the OCR engine interface (see core.js). Tesseract runs in a
// web worker; its code, WASM core and English data load from jsdelivr on first use.
// The ESM build only has a default export.
import Tesseract from "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js";

export function createBrowserEngine() {
  let workerPromise;
  const worker = () => (workerPromise ??= Tesseract.createWorker("eng", 1));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });

  return {
    // Blob/File → raw RGBA pixels, exactly as stored: no colour-profile conversion, so
    // the numbers match what Node/sharp sees (the thresholds were tuned there).
    async decode(blob) {
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { data, width: canvas.width, height: canvas.height, channels: 4 };
    },

    async recognize(bm, params, blocks = false) {
      const c = document.createElement("canvas");
      c.width = bm.width;
      c.height = bm.height;
      const img = c.getContext("2d").createImageData(bm.width, bm.height);
      for (let i = 0, p = 0; i < bm.gray.length; i++, p += 4) {
        img.data[p] = img.data[p + 1] = img.data[p + 2] = bm.gray[i];
        img.data[p + 3] = 255;
      }
      c.getContext("2d").putImageData(img, 0, 0);
      const w = await worker();
      await w.setParameters(params);
      return (await w.recognize(c, {}, blocks ? { blocks: true } : {})).data;
    },

    // Start downloading Tesseract before the user needs it.
    warmUp() { worker(); },
  };
}
