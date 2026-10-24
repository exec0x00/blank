import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const prefix = Buffer.from('CDXW1');
function keyFrom(secret: string): Buffer { return createHash('sha256').update(secret).digest(); }

// Only account credentials use encryption. Workspace files deliberately remain plain text.
export function encryptBuffer(data: Buffer, secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([prefix, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBuffer(data: Buffer, secret: string): Buffer {
  if (data.length < 33 || !data.subarray(0, 5).equals(prefix)) throw new Error('Invalid protected credential data.');
  const cipher = createDecipheriv('aes-256-gcm', keyFrom(secret), data.subarray(5, 17));
  cipher.setAuthTag(data.subarray(17, 33));
  return Buffer.concat([cipher.update(data.subarray(33)), cipher.final()]);
}
