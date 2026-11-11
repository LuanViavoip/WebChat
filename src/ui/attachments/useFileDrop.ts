import { useEffect, useState, type RefObject } from 'react';

export function useFileDrop(
  target: RefObject<HTMLElement | null>,
  options: { enabled: boolean; onFiles: (files: File[]) => void },
): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const enabled = options.enabled;
  const onFiles = options.onFiles;

  useEffect(() => {
    function preventFileNavigation(event: DragEvent) {
      if (!event.dataTransfer?.types.includes('Files')) {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  useEffect(() => {
    const node = target.current;
    if (!node) {
      return;
    }
    let depth = 0;

    function hasFiles(event: DragEvent): boolean {
      return Boolean(event.dataTransfer?.types.includes('Files'));
    }

    function onEnter(event: DragEvent) {
      if (!enabled || !hasFiles(event)) {
        return;
      }
      event.preventDefault();
      depth += 1;
      setDragging(true);
    }

    function onLeave(event: DragEvent) {
      if (!enabled || !hasFiles(event)) {
        return;
      }
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDragging(false);
      }
    }

    function onOver(event: DragEvent) {
      if (!enabled || !hasFiles(event)) {
        return;
      }
      event.preventDefault();
    }

    function onDrop(event: DragEvent) {
      if (!enabled || !hasFiles(event)) {
        return;
      }
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = event.dataTransfer ? [...event.dataTransfer.files] : [];
      if (files.length > 0) {
        onFiles(files);
      }
    }

    node.addEventListener('dragenter', onEnter);
    node.addEventListener('dragleave', onLeave);
    node.addEventListener('dragover', onOver);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragenter', onEnter);
      node.removeEventListener('dragleave', onLeave);
      node.removeEventListener('dragover', onOver);
      node.removeEventListener('drop', onDrop);
    };
  }, [enabled, onFiles, target]);

  return { dragging };
}
