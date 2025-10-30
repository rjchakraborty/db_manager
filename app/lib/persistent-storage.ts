import CryptoJS from "crypto-js";

// Stable encryption key that doesn't change between sessions
const APP_SECRET = "db-manager-v2-stable-key-2024";
const MASTER_KEY_STORAGE = "db-manager-master-key";
const BACKUP_PREFIX = "db-manager-backup-";
const DATA_VERSION_KEY = "db-manager-data-version";
const CURRENT_DATA_VERSION = "2.0";

// Generate a stable master key for encryption
const getMasterKey = (): string => {
  try {
    // First, try to get existing master key
    let masterKey = localStorage.getItem(MASTER_KEY_STORAGE);

    if (!masterKey) {
      // Generate a new stable master key based on app secret and timestamp
      // This will be consistent for the same browser/installation
      const browserFingerprint = [
        APP_SECRET,
        navigator.language || "en-US",
        new Date().getTimezoneOffset().toString(),
        // Use a fixed timestamp to ensure consistency
        "2024-10-30",
      ].join("|");

      masterKey = CryptoJS.SHA256(browserFingerprint).toString();

      // Store the master key for future use
      localStorage.setItem(MASTER_KEY_STORAGE, masterKey);

      console.log("Generated new stable master key for encryption");
    }

    return masterKey;
  } catch (error) {
    console.error("Error generating master key:", error);
    // Fallback to a fixed key (less secure but stable)
    return CryptoJS.SHA256(APP_SECRET + "fallback-key").toString();
  }
};

// Enhanced encryption with error handling
export const encrypt = (text: string): string => {
  try {
    const key = getMasterKey();
    const encrypted = CryptoJS.AES.encrypt(text, key).toString();
    return encrypted;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
};

// Enhanced decryption with multiple fallback strategies
export const decrypt = (encryptedText: string): string => {
  try {
    const key = getMasterKey();
    const decrypted = CryptoJS.AES.decrypt(encryptedText, key);
    const originalText = decrypted.toString(CryptoJS.enc.Utf8);

    if (!originalText) {
      throw new Error("Failed to decrypt with current key");
    }

    return originalText;
  } catch (error) {
    // Try fallback decryption strategies
    const fallbackResult = tryFallbackDecryption(encryptedText);
    if (fallbackResult) {
      // Re-encrypt with current key for future consistency
      try {
        const reEncrypted = encrypt(fallbackResult);
        return fallbackResult;
      } catch {
        return fallbackResult;
      }
    }

    throw new Error(
      `Decryption failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

// Try various fallback decryption methods
const tryFallbackDecryption = (encryptedText: string): string | null => {
  // Strategy 1: Try with old browser-based key generation
  try {
    const oldBrowserData = [
      navigator.userAgent,
      navigator.language,
      screen.width.toString(),
      screen.height.toString(),
      new Date().getTimezoneOffset().toString(),
    ].join("|");

    const oldKey = CryptoJS.SHA256(
      oldBrowserData + "db-manager-secret"
    ).toString();
    const decrypted = CryptoJS.AES.decrypt(encryptedText, oldKey);
    const result = decrypted.toString(CryptoJS.enc.Utf8);

    if (result) {
      console.log(
        "Successfully recovered data using old key generation method"
      );
      return result;
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Try with different browser data combinations
  const fallbackKeys = [
    // Try without screen dimensions (in case window was resized)
    [
      navigator.userAgent,
      navigator.language,
      new Date().getTimezoneOffset().toString(),
    ].join("|"),
    // Try with just language and timezone
    [navigator.language, new Date().getTimezoneOffset().toString()].join("|"),
    // Try with just the app secret
    APP_SECRET,
  ];

  for (const keyData of fallbackKeys) {
    try {
      const fallbackKey = CryptoJS.SHA256(
        keyData + "db-manager-secret"
      ).toString();
      const decrypted = CryptoJS.AES.decrypt(encryptedText, fallbackKey);
      const result = decrypted.toString(CryptoJS.enc.Utf8);

      if (result) {
        console.log("Successfully recovered data using fallback key strategy");
        return result;
      }
    } catch {
      // Continue to next key
    }
  }

  return null;
};

export const encryptObject = <T>(obj: T): string => {
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString);
};

export const decryptObject = <T>(encryptedText: string): T => {
  const decryptedString = decrypt(encryptedText);
  return JSON.parse(decryptedString) as T;
};

// Enhanced storage utilities with backup and recovery
export const robustStorage = {
  set: <T>(key: string, value: T): void => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) {
        throw new Error("localStorage not available");
      }

      // Create backup of existing data
      robustStorage.createBackup(key);

      // Encrypt and store new data
      const encrypted = encryptObject(value);
      localStorage.setItem(key, encrypted);

      // Store version info
      localStorage.setItem(DATA_VERSION_KEY, CURRENT_DATA_VERSION);

      // Verify storage was successful
      const verification = robustStorage.get<T>(key);
      if (!verification) {
        throw new Error("Storage verification failed");
      }
    } catch (error) {
      console.error(`Error storing data for key ${key}:`, error);

      // Try storing as plain JSON as fallback
      try {
        const plainJson = JSON.stringify(value);
        localStorage.setItem(key + "-plain", plainJson);
        console.log(`Stored as plain JSON fallback for key: ${key}`);
      } catch (fallbackError) {
        console.error(
          `Fallback storage also failed for key ${key}:`,
          fallbackError
        );
        throw new Error("Failed to store data securely");
      }
    }
  },

  get: <T>(key: string): T | null => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) {
        return null;
      }

      const encrypted = localStorage.getItem(key);
      if (!encrypted) {
        // Try plain JSON fallback
        const plainFallback = localStorage.getItem(key + "-plain");
        if (plainFallback) {
          try {
            const parsed = JSON.parse(plainFallback) as T;
            // Migrate to encrypted storage
            robustStorage.set(key, parsed);
            localStorage.removeItem(key + "-plain");
            console.log(
              `Migrated plain JSON data to encrypted storage for key: ${key}`
            );
            return parsed;
          } catch {
            return null;
          }
        }
        return null;
      }

      try {
        // Try normal decryption
        return decryptObject<T>(encrypted);
      } catch (decryptError) {
        console.warn(
          `Decryption failed for key ${key}, trying recovery methods...`
        );

        // Try to recover from backup
        const recovered = robustStorage.recoverFromBackup<T>(key);
        if (recovered) {
          console.log(
            `Successfully recovered data from backup for key: ${key}`
          );
          // Re-store with current encryption
          robustStorage.set(key, recovered);
          return recovered;
        }

        // Try parsing as plain JSON (backward compatibility)
        try {
          const parsed = JSON.parse(encrypted) as T;
          console.log(`Parsed corrupted data as plain JSON for key: ${key}`);
          // Migrate to encrypted storage
          robustStorage.set(key, parsed);
          return parsed;
        } catch {
          console.error(`All recovery methods failed for key: ${key}`);

          // Clean up corrupted data
          localStorage.removeItem(key);
          return null;
        }
      }
    } catch (error) {
      console.error(`Error retrieving data for key ${key}:`, error);
      return null;
    }
  },

  remove: (key: string): void => {
    if (typeof window === "undefined" || !window?.localStorage) return;

    // Create backup before removal
    robustStorage.createBackup(key);

    localStorage.removeItem(key);
    localStorage.removeItem(key + "-plain"); // Remove fallback too
  },

  clear: (): void => {
    if (typeof window === "undefined" || !window?.localStorage) return;

    // Create full backup before clearing
    robustStorage.createFullBackup();

    localStorage.clear();
  },

  // Backup functionality
  createBackup: (key: string): void => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return;

      const data = localStorage.getItem(key);
      if (data) {
        const backupKey = `${BACKUP_PREFIX}${key}-${Date.now()}`;
        localStorage.setItem(backupKey, data);

        // Keep only last 3 backups per key
        robustStorage.cleanupOldBackups(key);
      }
    } catch (error) {
      console.error(`Error creating backup for key ${key}:`, error);
    }
  },

  recoverFromBackup: <T>(key: string): T | null => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return null;

      // Find the most recent backup for this key
      const backupKeys = Object.keys(localStorage)
        .filter((k) => k.startsWith(`${BACKUP_PREFIX}${key}-`))
        .sort((a, b) => {
          const timestampA = parseInt(a.split("-").pop() || "0");
          const timestampB = parseInt(b.split("-").pop() || "0");
          return timestampB - timestampA;
        });

      for (const backupKey of backupKeys) {
        try {
          const backupData = localStorage.getItem(backupKey);
          if (backupData) {
            return decryptObject<T>(backupData);
          }
        } catch {
          // Try next backup
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error recovering from backup for key ${key}:`, error);
      return null;
    }
  },

  cleanupOldBackups: (key: string): void => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return;

      const backupKeys = Object.keys(localStorage)
        .filter((k) => k.startsWith(`${BACKUP_PREFIX}${key}-`))
        .sort((a, b) => {
          const timestampA = parseInt(a.split("-").pop() || "0");
          const timestampB = parseInt(b.split("-").pop() || "0");
          return timestampB - timestampA;
        });

      // Keep only the 3 most recent backups
      const toDelete = backupKeys.slice(3);
      toDelete.forEach((backupKey) => {
        localStorage.removeItem(backupKey);
      });
    } catch (error) {
      console.error(`Error cleaning up backups for key ${key}:`, error);
    }
  },

  createFullBackup: (): string | null => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return null;

      const allData: Record<string, string> = {};

      // Backup all non-backup data
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith(BACKUP_PREFIX)) {
          const value = localStorage.getItem(key);
          if (value) {
            allData[key] = value;
          }
        }
      });

      const backupJson = JSON.stringify(allData);
      const backupKey = `${BACKUP_PREFIX}full-${Date.now()}`;
      localStorage.setItem(backupKey, backupJson);

      return backupKey;
    } catch (error) {
      console.error("Error creating full backup:", error);
      return null;
    }
  },

  // Data integrity and migration
  checkDataIntegrity: (): { healthy: boolean; issues: string[] } => {
    const issues: string[] = [];

    try {
      if (typeof window === "undefined" || !window?.localStorage) {
        issues.push("localStorage not available");
        return { healthy: false, issues };
      }

      // Check version
      const version = localStorage.getItem(DATA_VERSION_KEY);
      if (version !== CURRENT_DATA_VERSION) {
        issues.push(
          `Data version mismatch: expected ${CURRENT_DATA_VERSION}, got ${
            version || "none"
          }`
        );
      }

      // Test encryption/decryption
      try {
        const testData = {
          test: "data integrity check",
          timestamp: Date.now(),
        };
        const encrypted = encryptObject(testData);
        const decrypted = decryptObject<typeof testData>(encrypted);

        if (decrypted.test !== testData.test) {
          issues.push("Encryption/decryption test failed");
        }
      } catch (error) {
        issues.push(
          `Encryption test failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      return { healthy: issues.length === 0, issues };
    } catch (error) {
      issues.push(
        `Integrity check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return { healthy: false, issues };
    }
  },

  // Export/Import functionality for manual backup/restore
  exportData: (): string | null => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) return null;

      const exportData: Record<string, any> = {};

      // Export key application data
      const keysToExport = [
        "db-connections",
        "default-connection-id",
        "query-history",
        "db-schema-cache",
        "gemini-api-key",
      ];

      keysToExport.forEach((key) => {
        const data = robustStorage.get(key);
        if (data) {
          exportData[key] = data;
        }
      });

      const exportObject = {
        version: CURRENT_DATA_VERSION,
        timestamp: new Date().toISOString(),
        data: exportData,
      };

      return JSON.stringify(exportObject, null, 2);
    } catch (error) {
      console.error("Error exporting data:", error);
      return null;
    }
  },

  importData: (jsonData: string): { success: boolean; message: string } => {
    try {
      if (typeof window === "undefined" || !window?.localStorage) {
        return { success: false, message: "localStorage not available" };
      }

      const importObject = JSON.parse(jsonData);

      if (!importObject.data) {
        return { success: false, message: "Invalid backup format" };
      }

      // Create backup before import
      robustStorage.createFullBackup();

      let importedCount = 0;
      Object.entries(importObject.data).forEach(([key, value]) => {
        try {
          robustStorage.set(key, value);
          importedCount++;
        } catch (error) {
          console.error(`Failed to import ${key}:`, error);
        }
      });

      return {
        success: importedCount > 0,
        message: `Successfully imported ${importedCount} items`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Import failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  },
};

// Compatibility layer for existing code
export const secureStorage = robustStorage;
