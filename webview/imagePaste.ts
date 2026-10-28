// Pasting and dropping images (PLAN.md §5, Phase 4). The webview only reads the bytes; the host
// saves the file, and the link is inserted as an ordinary edit once the host says where it is.

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { IMAGE_TYPES } from '../src/images';

function imageFiles(files: FileList | null | undefined): File[] {
  return [...(files ?? [])].filter((file) => Object.hasOwn(IMAGE_TYPES, file.type));
}

/**
 * Calls `onImages` for pasted and dropped image files. A paste that also carries text (a copied
 * spreadsheet range, say) is left alone, since the text is what the user copied. `pos` is where
 * an image was dropped, or null for a paste.
 */
export function imageHandlers(onImages: (files: File[], pos: number | null) => void): Extension {
  return EditorView.domEventHandlers({
    paste(event) {
      const data = event.clipboardData;
      const files = imageFiles(data?.files);
      if (files.length === 0 || data?.types.includes('text/plain')) {
        return false;
      }
      event.preventDefault();
      onImages(files, null);
      return true;
    },
    dragover(event) {
      // Without this the browser would not let a file be dropped here.
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
      }
      return false;
    },
    drop(event, view) {
      const files = imageFiles(event.dataTransfer?.files);
      if (files.length === 0) {
        return false;
      }
      event.preventDefault();
      onImages(files, view.posAtCoords({ x: event.clientX, y: event.clientY }));
      return true;
    },
  });
}

/** The file's bytes as base64, which is what travels to the host. */
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(file);
  });
}
