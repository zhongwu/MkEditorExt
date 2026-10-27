import { randomBytes } from 'crypto';

/** A random value for the Content Security Policy's script and style nonces. */
export function getNonce(): string {
  return randomBytes(16).toString('base64');
}
