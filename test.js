import LibRaw from 'libraw-wasm';
import fs from 'fs';

async function main() {
  const libRaw = new LibRaw();
  const buffer = fs.readFileSync('test.dng');
  const uint8Array = new Uint8Array(buffer);

  try {
    console.log("Opening...");
    await libRaw.open(uint8Array, {
      useCameraWb: true,
      outputColor: 1,
      outputBps: 8,
      userQual: 3,
    });

    console.log("Decoding imageData...");
    const imgData = await libRaw.imageData();
    console.log("imageData success:", imgData ? true : false);
    if (imgData) {
      console.log("Width:", imgData.width);
      console.log("Height:", imgData.height);
      console.log("Colors:", imgData.colors);
      console.log("Bits:", imgData.bits);
      console.log("Data size:", imgData.data.length);
      console.log("First 10 pixels:", imgData.data.slice(0, 10));
    }

    console.log("Extracting thumbnail...");
    const thumbData = await libRaw.thumbnailData();
    console.log("thumbnailData success:", thumbData ? true : false);
    if (thumbData) {
      console.log("Thumb Format:", thumbData.format);
      console.log("Thumb width:", thumbData.width);
      console.log("Thumb height:", thumbData.height);
      console.log("Thumb data size:", thumbData.data.length);
    }
    
    // forcefully exit because WebWorker might keep process alive
    process.exit(0);

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
