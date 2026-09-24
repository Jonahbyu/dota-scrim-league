// Node implementation of the OCR engine interface (see public/lib/ocr/core.js).
// Used by tests and dev scripts; the website uses public/lib/ocr/engine-browser.js.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

const TESSDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "tessdata");

export function createNodeEngine({ debugDir } = {}) {
  let workerPromise;
  // English data downloads from the default CDN on first use and is cached in data/tessdata.
  const worker = () => (workerPromise ??= (mkdirSync(TESSDATA, { recursive: true }), createWorker("eng", 1, { cachePath: TESSDATA })));
  const toPng = (bm) => sharp(Buffer.from(bm.gray), { raw: { width: bm.width, height: bm.height, channels: 1 } }).png().toBuffer();
  let imageIndex = -1;

  return {
    async decode(buffer) {
      imageIndex++;
      const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height, channels: info.channels };
    },

    async recognize(bm, params, blocks = false) {
      const w = await worker();
      await w.setParameters(params);
      return (await w.recognize(await toPng(bm), {}, blocks ? { blocks: true } : {})).data;
    },

    debug: debugDir
      ? (name, bm) => {
          if (!name) return;
          const dir = path.join(debugDir, `img${imageIndex}`);
          mkdirSync(dir, { recursive: true });
          toPng(bm).then((b) => sharp(b).toFile(path.join(dir, `${name}.png`)));
        }
      : null,

    async terminate() {
      if (workerPromise) await (await workerPromise).terminate();
      workerPromise = undefined;
    },
  };
}
