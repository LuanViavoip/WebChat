import { useEffect, useMemo } from 'react';
import { browserObjectUrls, type ObjectUrlFactory } from '../../transport/objectUrls';

export function useObjectUrl(blob: Blob | null, factory: ObjectUrlFactory = browserObjectUrls): string | null {
  const url = useMemo(() => (blob ? factory.create(blob) : null), [blob, factory]);
  useEffect(() => {
    return () => {
      if (url) {
        factory.revoke(url);
      }
    };
  }, [factory, url]);
  return url;
}
