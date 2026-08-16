import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface EnvelopeEncryptedPayload {
  encryptedDek: string;
  dekIv: string;
  dekTag: string;
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
  algorithm: "AES-256-GCM";
}

export class EncryptionService {
  /** Cloudflare Worker env bindings are injected per request, so never cache the KEK at module load. */
  private getMasterKey(): Buffer {
    return createHash("sha256").update(config.CREDENTIAL_ENCRYPTION_KEY).digest();
  }

  private buildAad(context?: { tenantId?: string; userId?: string }): Buffer {
    const tenant = context?.tenantId || "global";
    const user = context?.userId || "global";
    return Buffer.from(`mailwarden:tenant=${tenant};user=${user}`, "utf8");
  }

  encrypt(
    plaintext: string,
    context?: { tenantId?: string; userId?: string },
    keyVersion: string = config.KEY_VERSION
  ): EnvelopeEncryptedPayload {
    const dek = randomBytes(32);

    const dataIv = randomBytes(12);
    const dataCipher = createCipheriv("aes-256-gcm", dek, dataIv);
    let ciphertext = dataCipher.update(plaintext, "utf8", "hex");
    ciphertext += dataCipher.final("hex");
    const dataTag = dataCipher.getAuthTag().toString("hex");

    const dekIv = randomBytes(12);
    const kekCipher = createCipheriv("aes-256-gcm", this.getMasterKey(), dekIv);
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

  decrypt(
    payload: EnvelopeEncryptedPayload,
    context?: { tenantId?: string; userId?: string }
  ): string {
    try {
      const dekIv = Buffer.from(payload.dekIv, "hex");
      const dekTag = Buffer.from(payload.dekTag, "hex");
      const kekDecipher = createDecipheriv("aes-256-gcm", this.getMasterKey(), dekIv);
      kekDecipher.setAAD(this.buildAad(context));
      kekDecipher.setAuthTag(dekTag);

      let dekHex = kekDecipher.update(payload.encryptedDek, "hex", "utf8");
      dekHex += kekDecipher.final("utf8");
      const dek = Buffer.from(dekHex, "hex");

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

  encryptJson<T extends object>(
    data: T,
    context?: { tenantId?: string; userId?: string },
    keyVersion?: string
  ): EnvelopeEncryptedPayload {
    return this.encrypt(JSON.stringify(data), context, keyVersion);
  }

  decryptJson<T extends object>(
    payload: EnvelopeEncryptedPayload,
    context?: { tenantId?: string; userId?: string }
  ): T {
    return JSON.parse(this.decrypt(payload, context)) as T;
  }
}

export const encryptionService = new EncryptionService();
