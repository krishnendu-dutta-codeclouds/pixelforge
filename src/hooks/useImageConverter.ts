import { useState, useCallback, useRef } from 'react';
import { RawProcessor } from '../utils/rawProcessor';

export const useImageConverter = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processorRef = useRef<RawProcessor | null>(null);

  const convertFile = useCallback(async (file: File, quality: number = 0.92) => {
    setIsProcessing(true);
    setError(null);

    try {
      if (!processorRef.current) {
        processorRef.current = new RawProcessor();
      }

      const result = await processorRef.current.convertToJpg(file, quality);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during conversion';
      setError(message);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return { convertFile, isProcessing, error };
};
