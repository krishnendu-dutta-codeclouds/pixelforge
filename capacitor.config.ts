import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pixelforge.app',
  appName: 'PixelForge',
  webDir: 'dist',
  plugins: {
    Filesystem: {
      android: {
        // Allow writing to external storage
        allowExternalStorage: true
      }
    }
  }
};

export default config;
