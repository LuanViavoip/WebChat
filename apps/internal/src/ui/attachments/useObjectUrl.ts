import { useEffect, useState } from 'react';
import { browserObjectUrls, type ObjectUrlFactory } from '../../transport/objectUrls';

export function useObjectUrl(blob: Blob | null, factory: ObjectUrlFactory = browserObjectUrls): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      return;
    }
    const next = factory.create(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL.createObjectURL precisa nascer e morrer no mesmo efeito (StrictMode)
    setUrl(next);
    return () => {
      factory.revoke(next);
      setUrl(null);
    };
  }, [blob, factory]);
  return url;
}
