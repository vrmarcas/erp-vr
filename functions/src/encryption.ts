/**
 * encryption.ts
 * Utilitários de criptografia simétrica AES-256-GCM
 * Chave mestra lida das Firebase Secret Environment Variables
 */

import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;   // 96 bits — recomendado para GCM
const TAG_LENGTH = 16;  // 128 bits

/**
 * Criptografa uma string com AES-256-GCM.
 * Formato de saída: iv_hex:tag_hex:ciphertext_hex
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes (64 hex chars)");

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decriptografa uma string previamente cifrada com encrypt().
 */
export function decrypt(ciphertext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const [ivHex, tagHex, encryptedHex] = ciphertext.split(":");

  if (!ivHex || !tagHex || !encryptedHex) throw new Error("Formato de token inválido");

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
