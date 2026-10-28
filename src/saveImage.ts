import * as vscode from 'vscode';
import {
  IMAGE_FOLDER,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  imageAlt,
  imageFileName,
  imageMimeForName,
} from './images';

/** The path to link to, relative to the document, and the alt text to use. */
export interface SavedImage {
  path: string;
  alt: string;
}

/** Copies image bytes into `assets/` next to the document under a free file name. */
async function writeImage(
  documentFolder: vscode.Uri,
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<string | undefined> {
  if (bytes.length > MAX_IMAGE_BYTES) {
    void vscode.window.showErrorMessage(
      `That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB, so it was not added.`,
    );
    return undefined;
  }
  try {
    const folder = vscode.Uri.joinPath(documentFolder, IMAGE_FOLDER);
    await vscode.workspace.fs.createDirectory(folder);
    const existing = new Set(
      (await vscode.workspace.fs.readDirectory(folder)).map(([entry]) => entry.toLowerCase()),
    );
    const fileName = imageFileName(
      name,
      mime,
      (candidate) => existing.has(candidate.toLowerCase()),
      new Date(),
    );
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, fileName), bytes);
    return `${IMAGE_FOLDER}/${fileName}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`The image could not be saved: ${reason}`);
    return undefined;
  }
}

/**
 * Saves a pasted or dropped image (bytes as base64) into `assets/` next to the document and
 * returns the path to link to, or undefined, after telling the user why, if it was not saved.
 */
export function saveImage(
  documentFolder: vscode.Uri,
  image: { name: string; mime: string; data: string },
): Promise<string | undefined> {
  return writeImage(documentFolder, image.name, image.mime, Buffer.from(image.data, 'base64'));
}

/**
 * Lets the user pick an image file. One already inside the document's folder is linked where it
 * is; any other is copied into `assets/`.
 */
export async function pickImage(documentFolder: vscode.Uri): Promise<SavedImage | undefined> {
  const [file] =
    (await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: documentFolder,
      openLabel: 'Insert image',
      filters: { Images: [...Object.values(IMAGE_TYPES), 'jpeg'] },
    })) ?? [];
  if (!file) {
    return undefined;
  }
  const alt = imageAlt(file.path);
  const inside = documentFolder.path.replace(/\/$/, '') + '/';
  if (file.scheme === documentFolder.scheme && file.path.startsWith(inside)) {
    return { path: file.path.slice(inside.length), alt };
  }
  const mime = imageMimeForName(file.path);
  if (!mime) {
    void vscode.window.showErrorMessage('That file is not a supported image.');
    return undefined;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(file);
    const path = await writeImage(documentFolder, file.path, mime, bytes);
    return path ? { path, alt } : undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`The image could not be read: ${reason}`);
    return undefined;
  }
}
