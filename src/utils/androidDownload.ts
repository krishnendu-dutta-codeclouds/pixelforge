import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

/**
 * Save a blob to the device's Downloads folder on Android
 * Uses Capacitor Filesystem plugin for proper storage access
 */
export async function saveBlobToDownloads(
  blob: Blob,
  filename: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  // Convert blob to base64
  const base64 = await blobToBase64(blob);
  
  // Remove data URL prefix if present
  const base64Data = base64.split(',')[1] || base64;
  
  try {
    // Write to External directory (Downloads folder on Android)
    // Omit encoding parameter - plugin will decode base64 automatically
    const result = await Filesystem.writeFile({
      path: `Download/${filename}`,
      data: base64Data,
      directory: Directory.ExternalStorage,
      recursive: true,
    });
    
    return { success: true, path: result.uri };
  } catch (error) {
    console.error('Failed to save to Downloads:', error);
    
    // Fallback: try Documents directory
    try {
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      });
      return { success: true, path: result.uri };
    } catch (fallbackError) {
      console.error('Failed to save to Documents:', fallbackError);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}

/**
 * Save multiple blobs as a ZIP to Downloads
 */
export async function saveZipToDownloads(
  blobs: { blob: Blob; filename: string }[],
  zipName: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    for (const { blob, filename } of blobs) {
      const base64 = await blobToBase64(blob);
      const base64Data = base64.split(',')[1] || base64;
      zip.file(filename, base64Data, { base64: true });
    }
    
    // Generate ZIP as base64 directly (more efficient)
    const zipBase64 = await zip.generateAsync({ type: 'base64' });
    
    // Write ZIP directly - omit encoding parameter for base64 data
    try {
      const result = await Filesystem.writeFile({
        path: `Download/${zipName}`,
        data: zipBase64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      return { success: true, path: result.uri };
    } catch (error) {
      console.error('Failed to save ZIP to Downloads:', error);
      // Fallback to Documents
      try {
        const result = await Filesystem.writeFile({
          path: zipName,
          data: zipBase64,
          directory: Directory.Documents,
          recursive: true,
        });
        return { success: true, path: result.uri };
      } catch (fallbackError) {
        console.error('Failed to save ZIP to Documents:', fallbackError);
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    }
  } catch (error) {
    console.error('Failed to create ZIP:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Convert blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Check if we're running on Android (Capacitor)
 */
export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Check if we're running in a Capacitor app (native)
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}