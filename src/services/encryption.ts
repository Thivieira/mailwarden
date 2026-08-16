import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * True 2-Tier Envelope Encrypted Payload.
 * 
 * Hierarchy:
 * 1. KEK (Key Encryption Key): 256-bit master key derived from root secret or KMS.
 * 2. DEK (Data Encryption Key): Cryptographically random 256-bit key generated per-record.
 * 3. Payload: Plaintext data encrypted by DEK using AES-256-GCM.
 * 4. DEK Wrapping: DEK encrypted by KEK using AES-256-GCM with Authenticated Additional Data (AAD).
 */
export interface EnvelopeEncryptedPayload {
  encryptedDek: string; // hex of DEK encrypted by KEK
  dekIv: string;        // hex IV for DEK encryption
  dekTag: string;       // hex auth tag for DEK encryption
  ciphertext: string;   // hex of data encrypted by DEK
  iv: string;           // hex IV for data encryption
  tag: string;          // hex auth tag for data encryption
  keyVersion: string;   // KEK version e.g. "v1"
  algorithm: "AES-256-GCM";
}

export class EncryptionService {
  private masterKey: Buffer;
  private defaultKeyVersion: string;

  constructor() {
    this.defaultKeyVersion = config.KEY_VERSION;
    // Derive 256-bit master KEK from configured secret
    this.masterKey = createHash("sha256").update(config.CREDENTIAL_ENCRYPTION_KEY).digest();
  }

  /**
   * Builds deterministic Additional Authenticated Data (AAD) string for context binding.
   * This binds the ciphertext cryptographically to the specific tenant and user.
   */
  private buildAad(context?: { tenantId?: string; userId?: string }): Buffer {
    const tenant = context?.tenantId || "global";
    const user = context?.userId || "global";
    return Buffer.from(`mailwarden:tenant=${tenant};user=${user}`, "utf8");
  }

  /**
   * Performs true 2-tier envelope encryption:
   * 1. Generates a fresh 256-bit DEK.
   * 2. Encrypts plaintext using DEK with AES-256-GCM.
   * 3. Wraps DEK using KEK with AES-256-GCM and tenant/user AAD.
   */
  encrypt(
    plaintext: string,
    context?: { tenantId?: string; userId?: string },
    keyVersion: string = this.defaultKeyVersion
  ): EnvelopeEncryptedPayload {
    // 1. Generate unique 32-byte DEK
    const dek = randomBytes(32);

    // 2. Encrypt data with DEK
    const dataIv = randomBytes(12);
    const dataCipher = createCipheriv("aes-256-gcm", dek, dataIv);
    let ciphertext = dataCipher.update(plaintext, "utf8", "hex");
    ciphertext += dataCipher.final("hex");
    const dataTag = dataCipher.getAuthTag().toString("hex");

    // 3. Encrypt DEK with KEK (Master Key) using AAD
    const dekIv = randomBytes(12);
    const kekCipher = createCipheriv("aes-256-gcm", this.masterKey, dekIv);
    const aad = this.buildAad(context);
    kekCipher.setAAD(aad);

    let encryptedDek = kekCipher.update(dek.toString("hex"), "utf8", "hex");
    encryptedDek += kekCipher.final("hex");
    const dekTag = kekCipher.getAuthTag().toString("hex");

    return {
      encryptedDek,
      dekIv: dekIv.toString("hex"),
      dekTag,
      ciphertext,
      iv: dataIv.toString("hex"),
      tag: dataTag,
      keyVersion,
      algorithm: "AES-256-GCM",
    };
  }

  /**
   * Decrypts an envelope-encrypted payload:
   * 1. Unwraps DEK using KEK and verifies AAD.
   * 2. Decrypts ciphertext using unwrapped DEK and verifies payload auth tag.
   */
  decrypt(
    payload: EnvelopeEncryptedPayload,
    context?: { tenantId?: string; userId?: string }
  ): string {
    try {
      // 1. Unwrap DEK using KEK
      const dekIv = Buffer.from(payload.dekIv, "hex");
      const dekTag = Buffer.from(payload.dekTag, "hex");
      const kekDecipher = createDecipheriv("aes-256-gcm", this.masterKey, dekIv);
      const aad = this.buildAad(context);
      kekDecipher.setAAD(aad);
      kekDecipher.setAuthTag(dekTag);

      let dekHex = kekDecipher.update(payload.encryptedDek, "hex", "utf8");
      dekHex += kekDecipher.final("utf8");
      const dek = Buffer.from(dekHex, "hex");

      // 2. Decrypt ciphertext using DEK
      const dataIv = Buffer.from(payload.iv, "hex");
      const dataTag = Buffer.from(payload.tag, "hex");
      const dataDecipher = createDecipheriv("aes-256-gcm", dek, dataIv);
      dataDecipher.setAuthTag(dataTag);

      let decrypted = dataDecipher.update(payload.ciphertext, "hex", "utf8");
      decrypted += dataDecipher.final("utf8");
      return decrypted;
    } catch (err: any) {
      logger.error("Envelope decryption failed: cryptographic tag mismatch or unauthorized context", {
        keyVersion: payload.keyVersion,
        tenantContext: context?.tenantId,
        userContext: context?.userId,
      });
      throw new Error("Envelope decryption failed: key mismatch, unauthorized tenant context, or corrupted data.");
    }
  }

  /**
   * Helper to encrypt a structured JSON object
   */
  encryptJson<T extends object>(
    data: T,
    context?: { tenantId?: string; userId?: string },
    keyVersion?: string
  ): EnvelopeEncryptedPayload {
    return this.encrypt(JSON.stringify(data), context, keyVersion);
  }

  /**
   * Helper to decrypt and parse a structured JSON object
   */
  decryptJson<T extends object>(
    payload: EnvelopeEncryptedPayload,
    context?: { tenantId?: string; userId?: string }
  ): T {
    const jsonStr = this.decrypt(payload, context);
    return JSON.parse(jsonStr) as T;
  }
}

export const encryptionService = new EncryptionService();
