import CryptoJS from "crypto-js";

// Use a combination of browser-specific data to create a unique key
const getEncryptionKey = (): string => {
  // In a real-world scenario, you might want to ask users for a master password
  // For now, we'll use browser/session specific data
  const browserData = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
  ].join("|");

  return CryptoJS.SHA256(browserData + "db-manager-secret").toString();
};

export const encrypt = (text: string): string => {
  try {
    const key = getEncryptionKey();
    const encrypted = CryptoJS.AES.encrypt(text, key).toString();
    return encrypted;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
};

export const decrypt = (encryptedText: string): string => {
  try {
    const key = getEncryptionKey();
    const decrypted = CryptoJS.AES.decrypt(encryptedText, key);
    const originalText = decrypted.toString(CryptoJS.enc.Utf8);

    if (!originalText) {
      throw new Error("Failed to decrypt data - invalid key or corrupted data");
    }

    return originalText;
  } catch (_error) {
    // Suppress noisy console errors for expected cases (e.g., legacy/plaintext data)
    const message = _error instanceof Error ? _error.message : "Unknown error";
    throw new Error("DECRYPT_FAILED" + message);
  }
};

export const encryptObject = <T>(obj: T): string => {
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString);
};

export const decryptObject = <T>(encryptedText: string): T => {
  const decryptedString = decrypt(encryptedText);
  return JSON.parse(decryptedString) as T;
};

// Storage utilities with encryption
export const secureStorage = {
  set: <T>(key: string, value: T): void => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return;
      const encrypted = encryptObject(value);
      localStorage.setItem(key, encrypted);
    } catch (error) {
      console.error("Error storing encrypted data:", error);
      throw new Error("Failed to store data securely");
    }
  },

  get: <T>(key: string): T | null => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return null;
      const encrypted = localStorage.getItem(key);
      if (!encrypted) return null;
      try {
        // Normal path: decrypt previously stored cipher text
        return decryptObject<T>(encrypted);
      } catch (_decryptError: unknown) {
        // Backward-compat: attempt to parse plaintext JSON (legacy storage)
        try {
          const parsed = JSON.parse(encrypted) as T;
          // Migrate to encrypted storage transparently
          secureStorage.set<T>(key, parsed);
          return parsed;
        } catch {
          // Remove corrupted/unreadable data silently
          try {
            localStorage.removeItem(key);
          } catch { }
          return null;
        }
      }
    } catch {
      // Any unexpected error: fail closed, no logs
      return null;
    }
  },

  remove: (key: string): void => {
    if (typeof window === "undefined" || !window?.localStorage) return;
    localStorage.removeItem(key);
  },

  clear: (): void => {
    if (typeof window === "undefined" || !window?.localStorage) return;
    localStorage.clear();
  },
};
