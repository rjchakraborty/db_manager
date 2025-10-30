import { robustStorage } from "./persistent-storage";
import { DatabaseConnection } from "@/types/database";
import { QueryHistoryEntry } from "./query-history";
import CryptoJS from "crypto-js";

// Migration utility to recover data from the old encryption system
export class DataMigrationManager {
  private static readonly MIGRATION_FLAG = "db-manager-migrated-v2";
  private static readonly OLD_KEYS = [
    "db-connections",
    "default-connection-id",
    "query-history",
    "gemini-api-key",
  ];

  /**
   * Check if migration has already been performed
   */
  static isMigrationCompleted(): boolean {
    try {
      return (
        localStorage.getItem(DataMigrationManager.MIGRATION_FLAG) === "true"
      );
    } catch {
      return false;
    }
  }

  /**
   * Mark migration as completed
   */
  static markMigrationCompleted(): void {
    try {
      localStorage.setItem(DataMigrationManager.MIGRATION_FLAG, "true");
    } catch (error) {
      console.error("Error marking migration as completed:", error);
    }
  }

  /**
   * Perform comprehensive data migration
   */
  static async performMigration(): Promise<{
    success: boolean;
    recovered: string[];
    failed: string[];
    details: string;
  }> {
    const recovered: string[] = [];
    const failed: string[] = [];
    const details: string[] = [];

    console.log("Starting data migration process...");

    try {
      // Create a backup before migration
      const backupKey = robustStorage.createFullBackup();
      if (backupKey) {
        details.push(`Created full backup: ${backupKey}`);
      }

      // Migrate each key
      for (const key of DataMigrationManager.OLD_KEYS) {
        try {
          const result = await DataMigrationManager.migrateKey(key);
          if (result.success) {
            recovered.push(key);
            details.push(`✅ ${key}: ${result.message}`);
          } else {
            failed.push(key);
            details.push(`❌ ${key}: ${result.message}`);
          }
        } catch (error) {
          failed.push(key);
          details.push(
            `❌ ${key}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      // Special migration for schema cache (stored as plain JSON)
      try {
        const schemaCacheResult =
          DataMigrationManager.migrateSchemaCacheFromPlain();
        if (schemaCacheResult.success) {
          recovered.push("db-schema-cache");
          details.push(`✅ db-schema-cache: ${schemaCacheResult.message}`);
        }
      } catch (error) {
        details.push(
          `⚠️ db-schema-cache: ${
            error instanceof Error ? error.message : "Could not migrate"
          }`
        );
      }

      // Mark migration as completed if any data was recovered
      if (recovered.length > 0) {
        DataMigrationManager.markMigrationCompleted();
        details.push("Migration completed successfully");
      }

      const success = recovered.length > 0;
      const summary = `Migration ${success ? "completed" : "failed"}: ${
        recovered.length
      } recovered, ${failed.length} failed`;

      console.log(summary);
      console.log("Migration details:", details);

      return {
        success,
        recovered,
        failed,
        details: details.join("\n"),
      };
    } catch (error) {
      const errorMsg = `Migration process failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error(errorMsg);
      return {
        success: false,
        recovered,
        failed: DataMigrationManager.OLD_KEYS,
        details: errorMsg,
      };
    }
  }

  /**
   * Migrate a specific key from old encryption to new system
   */
  private static async migrateKey(key: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // First check if data is already available in new system
      const existingData = robustStorage.get(key);
      if (existingData) {
        return {
          success: true,
          message: "Data already available in new system",
        };
      }

      // Try to get raw data from localStorage
      const rawData = localStorage.getItem(key);
      if (!rawData) {
        return {
          success: false,
          message: "No data found in localStorage",
        };
      }

      // Try multiple recovery strategies
      let recoveredData = null;
      let recoveryMethod = "";

      // Strategy 1: Try parsing as plain JSON (for API keys and some settings)
      try {
        recoveredData = JSON.parse(rawData);
        recoveryMethod = "plain JSON";
      } catch {
        // Continue to encrypted strategies
      }

      // Strategy 2: Try the robust storage recovery (includes fallback decryption)
      if (!recoveredData) {
        try {
          // The robust storage get method includes fallback decryption logic
          recoveredData = robustStorage.get(key);
          if (recoveredData) {
            recoveryMethod = "robust storage recovery";
          }
        } catch {
          // Continue to manual strategies
        }
      }

      // Strategy 3: Try manual decryption with old key patterns
      if (!recoveredData) {
        recoveredData = DataMigrationManager.tryManualDecryption(rawData);
        if (recoveredData) {
          recoveryMethod = "manual decryption";
        }
      }

      if (recoveredData) {
        // Validate and store using new system
        const isValid = DataMigrationManager.validateRecoveredData(
          key,
          recoveredData
        );
        if (isValid) {
          robustStorage.set(key, recoveredData);
          return {
            success: true,
            message: `Recovered using ${recoveryMethod}`,
          };
        } else {
          return {
            success: false,
            message: `Recovered data failed validation (${recoveryMethod})`,
          };
        }
      }

      return {
        success: false,
        message: "All recovery strategies failed",
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error during migration",
      };
    }
  }

  /**
   * Try manual decryption with various old key generation methods
   */
  private static tryManualDecryption(encryptedData: string): any {
    // This is handled by the fallback decryption in persistent-storage.ts
    // But we can add additional strategies here if needed

    // Try with various old key combinations
    const oldKeyStrategies = [
      // Original pattern
      () => {
        const browserData = [
          navigator.userAgent,
          navigator.language,
          screen.width,
          screen.height,
          new Date().getTimezoneOffset(),
        ].join("|");
        return CryptoJS.SHA256(browserData + "db-manager-secret").toString();
      },

      // Without screen dimensions
      () => {
        const browserData = [
          navigator.userAgent,
          navigator.language,
          new Date().getTimezoneOffset(),
        ].join("|");
        return CryptoJS.SHA256(browserData + "db-manager-secret").toString();
      },

      // Minimal pattern
      () => {
        const browserData = [
          navigator.language,
          new Date().getTimezoneOffset(),
        ].join("|");
        return CryptoJS.SHA256(browserData + "db-manager-secret").toString();
      },
    ];

    for (const keyGenerator of oldKeyStrategies) {
      try {
        const key = keyGenerator();
        const decrypted = CryptoJS.AES.decrypt(encryptedData, key);
        const result = decrypted.toString(CryptoJS.enc.Utf8);

        if (result) {
          return JSON.parse(result);
        }
      } catch {
        // Continue to next strategy
      }
    }

    return null;
  }

  /**
   * Validate recovered data structure
   */
  private static validateRecoveredData(key: string, data: any): boolean {
    try {
      switch (key) {
        case "db-connections":
          return (
            Array.isArray(data) &&
            data.every(
              (conn: any) =>
                conn &&
                typeof conn.id === "string" &&
                typeof conn.name === "string"
            )
          );

        case "default-connection-id":
          return typeof data === "string" && data.length > 0;

        case "query-history":
          return (
            Array.isArray(data) &&
            data.every(
              (entry: any) =>
                entry &&
                typeof entry.id === "string" &&
                typeof entry.sql === "string"
            )
          );

        case "gemini-api-key":
          return typeof data === "string" && data.length > 0;

        default:
          return true; // Accept any data for unknown keys
      }
    } catch {
      return false;
    }
  }

  /**
   * Migrate schema cache from plain JSON storage
   */
  private static migrateSchemaCacheFromPlain(): {
    success: boolean;
    message: string;
  } {
    try {
      const schemaCache = localStorage.getItem("db-schema-cache");
      if (!schemaCache) {
        return {
          success: false,
          message: "No schema cache found",
        };
      }

      // Schema cache is typically stored as plain JSON, just verify it's valid
      JSON.parse(schemaCache);

      return {
        success: true,
        message: "Schema cache is already in correct format",
      };
    } catch (error) {
      return {
        success: false,
        message: `Schema cache migration failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Get migration status and recommendations
   */
  static getMigrationStatus(): {
    needsMigration: boolean;
    hasOldData: boolean;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let hasOldData = false;
    let needsMigration = false;

    try {
      // Check if migration was already completed
      if (DataMigrationManager.isMigrationCompleted()) {
        recommendations.push("✅ Migration already completed");
        return { needsMigration: false, hasOldData: false, recommendations };
      }

      // Check for old encrypted data
      for (const key of DataMigrationManager.OLD_KEYS) {
        const rawData = localStorage.getItem(key);
        if (rawData) {
          hasOldData = true;

          // Try to access with new system
          const newData = robustStorage.get(key);
          if (!newData) {
            needsMigration = true;
            recommendations.push(
              `❌ ${key}: Data exists but not accessible with new system`
            );
          } else {
            recommendations.push(`✅ ${key}: Data accessible`);
          }
        } else {
          recommendations.push(`⚠️ ${key}: No data found`);
        }
      }

      if (needsMigration) {
        recommendations.push(
          "🔧 Migration recommended to recover inaccessible data"
        );
      } else if (hasOldData) {
        recommendations.push("✅ All existing data is accessible");
      } else {
        recommendations.push("ℹ️ No existing data found - fresh installation");
      }
    } catch (error) {
      recommendations.push(
        `❌ Error checking migration status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      needsMigration = true;
    }

    return { needsMigration, hasOldData, recommendations };
  }

  /**
   * Manual data recovery for emergency situations
   */
  static emergencyDataRecovery(): {
    success: boolean;
    recovered: Record<string, any>;
    errors: string[];
  } {
    const recovered: Record<string, any> = {};
    const errors: string[] = [];

    try {
      // Try to recover all localStorage data as plain JSON first
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith("db-manager-backup-")) {
          try {
            const rawValue = localStorage.getItem(key);
            if (rawValue) {
              try {
                recovered[key] = JSON.parse(rawValue);
              } catch {
                // Store as string if not JSON
                recovered[key] = rawValue;
              }
            }
          } catch (error) {
            errors.push(
              `Failed to recover ${key}: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
          }
        }
      });

      return {
        success: Object.keys(recovered).length > 0,
        recovered,
        errors,
      };
    } catch (error) {
      errors.push(
        `Emergency recovery failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      return {
        success: false,
        recovered,
        errors,
      };
    }
  }
}
