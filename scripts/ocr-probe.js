// Dev tool: dump what Tesseract sees in a screenshot, with word boxes.
// Usage: node scripts/ocr-probe.js <image> [scale]
import sharp from "sharp";
import { createWorker } from "tesseract.js";

const [file, scale = "2"] = process.argv.slice(2);
const meta = await sharp(file).metadata();
const buf = await sharp(file)
  .resize(Math.round(meta.width * Number(scale)))
  .grayscale()
  .negate()
  .normalize()
  .png()
  .toBuffer();

const worker = await createWorker("eng");
const { data } = await worker.recognize(buf, {}, { blocks: true });
await worker.terminate();

console.log(`image ${meta.width}x${meta.height}, scaled x${scale}`);
for (const block of data.blocks ?? []) {
  for (const para of block.paragraphs) {
    for (const line of para.lines) {
      const words = line.words.map((w) => `${w.text}@${Math.round(w.bbox.x0 / scale)},${Math.round(w.bbox.y0 / scale)}(${Math.round(w.confidence)})`);
      console.log(words.join("  "));
    }
  }
}
