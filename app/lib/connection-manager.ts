import { DatabaseConnection } from "@/types/database";
import { robustStorage } from "@/lib/persistent-storage";
import { DataMigrationManager } from "@/lib/data-migration";

const CONNECTIONS_STORAGE_KEY = "db-connections";
const DEFAULT_CONNECTION_KEY = "default-connection-id";

export class ConnectionManager {
  static getAllConnections(): DatabaseConnection[] {
    try {
      // Check if migration is needed and perform it
      ConnectionManager.ensureMigration();

      const stored = robustStorage.get<DatabaseConnection[]>(
        CONNECTIONS_STORAGE_KEY
      );

      // Validate connections data
      if (stored && Array.isArray(stored)) {
        return stored.filter(
          (conn) =>
            conn &&
            typeof conn.id === "string" &&
            typeof conn.name === "string" &&
            typeof conn.host === "string"
        );
      }

      return [];
    } catch (error) {
      console.error("Error loading connections:", error);

      // Try emergency recovery
      const emergency = DataMigrationManager.emergencyDataRecovery();
      if (emergency.success && emergency.recovered[CONNECTIONS_STORAGE_KEY]) {
        try {
          const connections = emergency.recovered[CONNECTIONS_STORAGE_KEY];
          if (Array.isArray(connections)) {
            console.log("Recovered connections from emergency recovery");
            // Save using new system
            robustStorage.set(CONNECTIONS_STORAGE_KEY, connections);
            return connections;
          }
        } catch {
          // Emergency recovery failed too
        }
      }

      return [];
    }
  }

  static getDefaultConnectionId(): string | null {
    try {
      ConnectionManager.ensureMigration();
      return robustStorage.get<string>(DEFAULT_CONNECTION_KEY);
    } catch (error) {
      console.error("Error loading default connection:", error);
      return null;
    }
  }

  static getDefaultConnection(): DatabaseConnection | null {
    const connections = this.getAllConnections();

    if (connections.length === 0) {
      return null;
    }

    if (connections.length === 1) {
      // If only one connection, it's automatically the default
      return connections[0];
    }

    // Multiple connections - check for stored default
    const defaultId = this.getDefaultConnectionId();
    if (defaultId) {
      const defaultConnection = connections.find(
        (conn) => conn.id === defaultId
      );
      if (defaultConnection) {
        return defaultConnection;
      }
    }

    // No default set, return null (user must choose)
    return null;
  }

  static setDefaultConnection(connectionId: string): void {
    try {
      robustStorage.set(DEFAULT_CONNECTION_KEY, connectionId);
    } catch (error) {
      console.error("Error setting default connection:", error);
    }
  }

  static clearDefaultConnection(): void {
    try {
      robustStorage.remove(DEFAULT_CONNECTION_KEY);
    } catch (error) {
      console.error("Error clearing default connection:", error);
    }
  }

  static hasMultipleConnections(): boolean {
    return this.getAllConnections().length > 1;
  }

  static hasAnyConnection(): boolean {
    return this.getAllConnections().length > 0;
  }

  /**
   * Ensure data migration has been performed
   */
  private static migrationChecked = false;

  static ensureMigration(): void {
    // Only check migration once per session to avoid performance impact
    if (ConnectionManager.migrationChecked) {
      return;
    }

    ConnectionManager.migrationChecked = true;

    try {
      if (!DataMigrationManager.isMigrationCompleted()) {
        console.log("Checking for data that needs migration...");
        const status = DataMigrationManager.getMigrationStatus();

        if (status.needsMigration) {
          console.warn(
            "Data migration needed. Some data may be inaccessible until migration is performed."
          );
          console.log("Migration recommendations:", status.recommendations);

          // Perform automatic migration attempt
          DataMigrationManager.performMigration()
            .then((result) => {
              if (result.success) {
                console.log("✅ Automatic migration completed successfully");
                console.log("Recovered:", result.recovered);
              } else {
                console.error("❌ Automatic migration failed");
                console.error("Details:", result.details);
              }
            })
            .catch((error) => {
              console.error("Migration process error:", error);
            });
        }
      }
    } catch (error) {
      console.error("Error during migration check:", error);
    }
  }

  /**
   * Save a connection to storage
   */
  static saveConnection(connection: DatabaseConnection): boolean {
    try {
      const connections = ConnectionManager.getAllConnections();
      const existingIndex = connections.findIndex(
        (conn) => conn.id === connection.id
      );

      if (existingIndex >= 0) {
        connections[existingIndex] = connection;
      } else {
        connections.push(connection);
      }

      robustStorage.set(CONNECTIONS_STORAGE_KEY, connections);
      return true;
    } catch (error) {
      console.error("Error saving connection:", error);
      return false;
    }
  }

  /**
   * Delete a connection from storage
   */
  static deleteConnection(connectionId: string): boolean {
    try {
      const connections = ConnectionManager.getAllConnections();
      const filteredConnections = connections.filter(
        (conn) => conn.id !== connectionId
      );

      if (filteredConnections.length !== connections.length) {
        robustStorage.set(CONNECTIONS_STORAGE_KEY, filteredConnections);

        // Clear default connection if it was the deleted one
        if (ConnectionManager.getDefaultConnectionId() === connectionId) {
          ConnectionManager.clearDefaultConnection();
        }

        return true;
      }

      return false;
    } catch (error) {
      console.error("Error deleting connection:", error);
      return false;
    }
  }

  /**
   * Get connection by ID
   */
  static getConnectionById(connectionId: string): DatabaseConnection | null {
    const connections = ConnectionManager.getAllConnections();
    return connections.find((conn) => conn.id === connectionId) || null;
  }

  /**
   * Check data integrity and provide diagnostics
   */
  static checkDataIntegrity(): {
    healthy: boolean;
    issues: string[];
    connections: number;
    hasDefault: boolean;
  } {
    try {
      const storageCheck = robustStorage.checkDataIntegrity();
      const connections = ConnectionManager.getAllConnections();
      const defaultId = ConnectionManager.getDefaultConnectionId();

      const issues = [...storageCheck.issues];

      // Check connections integrity
      const invalidConnections = connections.filter(
        (conn) => !conn.id || !conn.name || !conn.host
      );

      if (invalidConnections.length > 0) {
        issues.push(`${invalidConnections.length} invalid connections found`);
      }

      // Check default connection validity
      if (defaultId && !connections.find((conn) => conn.id === defaultId)) {
        issues.push("Default connection ID points to non-existent connection");
      }

      return {
        healthy: storageCheck.healthy && issues.length === 0,
        issues,
        connections: connections.length,
        hasDefault: !!defaultId,
      };
    } catch (error) {
      return {
        healthy: false,
        issues: [
          `Integrity check failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
        connections: 0,
        hasDefault: false,
      };
    }
  }
}
