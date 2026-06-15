import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import path from 'path';

async function main() {
  // Start dev server
  const server = spawn('npm', ['run', 'dev'], { stdio: 'pipe' });
  
  await new Promise(r => setTimeout(r, 2000));

  console.log("Starting puppeteer...");
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:5173');

  // Let's inject a script to test libraw
  await page.evaluate(async () => {
    try {
      console.log("Fetching test.dng...");
      const res = await fetch('/test.dng');
      const buffer = await res.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      console.log("Fetched size:", uint8Array.length);

      // Access libraw from window if we can, or just wait for it.
      // Wait, we don't have LibRaw on window. 
      // Instead, we will simulate the file upload!
    } catch(e) {
      console.log("Eval error:", e);
    }
  });

  // Actually, let's just trigger a file upload
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile(path.resolve('test.dng'));

  console.log("Uploaded file...");
  
  // Wait a bit
  await new Promise(r => setTimeout(r, 1000));

  // Click convert
  const convertBtn = await page.$('.btn.primary');
  if (convertBtn) {
    await convertBtn.click();
    console.log("Clicked convert...");
  } else {
    console.log("Convert btn not found");
  }

  // Wait for processing
  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  server.kill();
  process.exit(0);
}

main();
