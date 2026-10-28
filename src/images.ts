// Names for pasted and dropped images (PLAN.md §5, Phase 4).
// No dependency on the `vscode` module, so it can be unit-tested.

/** Image types that can be pasted, and the file extension each one gets. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** Larger images are refused rather than copied into the project. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** The folder, next to the document, that pasted images are saved in. */
export const IMAGE_FOLDER = 'assets';

/** Names browsers give to clipboard images; they say nothing about the picture. */
const GENERIC = new Set(['image', 'blob', 'unknown', 'untitled', '']);

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** `pasted-20260131-141500`, from the local time. */
function timestampName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${date}-${time}`;
}

/** The part of a file name before its extension, safe to use in a path and a link. */
export function imageStem(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .replace(/[^\p{L}\p{N}_.-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return stem.slice(0, 80);
}

/**
 * Picks the file name for a pasted image: the original name when it means something,
 * otherwise a timestamp. `taken` says whether a name is already used in the folder; a number
 * is added to the name until it isn't.
 */
export function imageFileName(
  original: string,
  mime: string,
  taken: (name: string) => boolean,
  now: Date,
): string {
  const extension = IMAGE_TYPES[mime] ?? 'png';
  let stem = imageStem(original);
  if (GENERIC.has(stem.toLowerCase())) {
    stem = timestampName(now);
  }
  let name = `${stem}.${extension}`;
  for (let n = 1; taken(name); n++) {
    name = `${stem}-${n}.${extension}`;
  }
  return name;
}

/** The Markdown for an image; `alt` may not contain square brackets. */
export function imageMarkdown(alt: string, path: string): string {
  return `![${alt.replace(/[[\]]/g, '')}](${path})`;
}

/** The image type for a file name, from its extension, or undefined if it is not a known image. */
export function imageMimeForName(name: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(name)?.[1].toLowerCase();
  if (extension === 'jpeg') return 'image/jpeg';
  return Object.keys(IMAGE_TYPES).find((mime) => IMAGE_TYPES[mime] === extension);
}

/** Alt text for a dropped file: its name, unless that is a generic clipboard name. */
export function imageAlt(original: string): string {
  const stem = imageStem(original);
  return GENERIC.has(stem.toLowerCase()) ? '' : stem.replace(/[-_]+/g, ' ');
}
