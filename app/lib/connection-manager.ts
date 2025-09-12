import { DatabaseConnection } from "@/types/database";
import { secureStorage } from "@/lib/encryption";

const CONNECTIONS_STORAGE_KEY = "db-connections";
const DEFAULT_CONNECTION_KEY = "default-connection-id";

export class ConnectionManager {
  static getAllConnections(): DatabaseConnection[] {
    try {
      const stored = secureStorage.get<DatabaseConnection[]>(
        CONNECTIONS_STORAGE_KEY
      );
      return stored || [];
    } catch (error) {
      console.error("Error loading connections:", error);
      return [];
    }
  }

  static getDefaultConnectionId(): string | null {
    try {
      return secureStorage.get<string>(DEFAULT_CONNECTION_KEY);
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
      secureStorage.set(DEFAULT_CONNECTION_KEY, connectionId);
    } catch (error) {
      console.error("Error setting default connection:", error);
    }
  }

  static clearDefaultConnection(): void {
    try {
      secureStorage.remove(DEFAULT_CONNECTION_KEY);
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
}
