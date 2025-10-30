import { robustStorage } from "./persistent-storage";
import { DataMigrationManager } from "./data-migration";

export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  tableName?: string; // Table associated with this query (for targeted suggestions)
  schemaName?: string; // Schema name
  sql: string;
  title?: string; // AI-generated or auto-generated title
  description?: string; // Optional description
  executedAt: string;
  executionCount: number; // How many times this query was executed
  lastExecutedAt: string;
}

const QUERY_HISTORY_STORAGE_KEY = "query-history";
const MAX_HISTORY_PER_CONNECTION = 100; // Limit history to prevent storage overflow
const MAX_HISTORY_PER_TABLE = 20; // Limit per table

export class QueryHistoryManager {
  /**
   * Get query history for a connection, optionally filtered by table
   */
  static getHistory(
    connectionId?: string,
    tableName?: string
  ): QueryHistoryEntry[] {
    try {
      // Ensure migration has been attempted
      QueryHistoryManager.ensureMigration();

      const stored = robustStorage.get<QueryHistoryEntry[]>(
        QUERY_HISTORY_STORAGE_KEY
      );
      let history = stored || [];

      // Validate and filter out invalid entries
      history = history.filter(
        (entry: QueryHistoryEntry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.sql === "string" &&
          typeof entry.connectionId === "string"
      );

      if (connectionId) {
        history = history.filter(
          (entry: QueryHistoryEntry) => entry.connectionId === connectionId
        );
      }

      if (tableName) {
        history = history.filter(
          (entry: QueryHistoryEntry) => entry.tableName === tableName
        );
      }

      // Sort by last executed date (most recent first)
      return history.sort(
        (a: QueryHistoryEntry, b: QueryHistoryEntry) =>
          new Date(b.lastExecutedAt).getTime() -
          new Date(a.lastExecutedAt).getTime()
      );
    } catch (error) {
      console.error("Error loading query history:", error);

      // Try emergency recovery
      try {
        const emergency = DataMigrationManager.emergencyDataRecovery();
        if (
          emergency.success &&
          emergency.recovered[QUERY_HISTORY_STORAGE_KEY]
        ) {
          const recoveredHistory =
            emergency.recovered[QUERY_HISTORY_STORAGE_KEY];
          if (Array.isArray(recoveredHistory)) {
            console.log("Recovered query history from emergency recovery");
            // Save using new system
            robustStorage.set(QUERY_HISTORY_STORAGE_KEY, recoveredHistory);
            return recoveredHistory;
          }
        }
      } catch {
        // Emergency recovery failed
      }

      return [];
    }
  }

  /**
   * Save a successful query to history or update if it already exists
   */
  static saveQuery(
    entry: Omit<
      QueryHistoryEntry,
      "id" | "executedAt" | "executionCount" | "lastExecutedAt"
    >
  ): QueryHistoryEntry {
    try {
      const allHistory =
        robustStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];

      // Normalize query for comparison (trim, lowercase, remove extra spaces)
      const normalizedSql = entry.sql.trim().toLowerCase().replace(/\s+/g, " ");

      // Check if this exact query already exists for this connection and table
      const existingIndex = allHistory.findIndex(
        (h: QueryHistoryEntry) =>
          h.connectionId === entry.connectionId &&
          h.tableName === entry.tableName &&
          h.sql.trim().toLowerCase().replace(/\s+/g, " ") === normalizedSql
      );

      let savedEntry: QueryHistoryEntry;

      if (existingIndex !== -1) {
        // Update existing entry - increment execution count
        savedEntry = {
          ...allHistory[existingIndex],
          executionCount: allHistory[existingIndex].executionCount + 1,
          lastExecutedAt: new Date().toISOString(),
          // Update title/description if provided
          title: entry.title || allHistory[existingIndex].title,
          description:
            entry.description || allHistory[existingIndex].description,
        };
        allHistory[existingIndex] = savedEntry;
      } else {
        // Create new entry
        savedEntry = {
          ...entry,
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          executedAt: new Date().toISOString(),
          executionCount: 1,
          lastExecutedAt: new Date().toISOString(),
        };
        allHistory.push(savedEntry);
      }

      // Enforce limits per connection
      const connectionHistory = allHistory.filter(
        (h: QueryHistoryEntry) => h.connectionId === entry.connectionId
      );
      if (connectionHistory.length > MAX_HISTORY_PER_CONNECTION) {
        // Remove oldest entries for this connection
        const sortedByDate = connectionHistory.sort(
          (a: QueryHistoryEntry, b: QueryHistoryEntry) =>
            new Date(a.lastExecutedAt).getTime() -
            new Date(b.lastExecutedAt).getTime()
        );
        const toRemove = sortedByDate.slice(
          0,
          connectionHistory.length - MAX_HISTORY_PER_CONNECTION
        );
        const idsToRemove = new Set(
          toRemove.map((h: QueryHistoryEntry) => h.id)
        );
        allHistory.splice(
          0,
          allHistory.length,
          ...allHistory.filter((h: QueryHistoryEntry) => !idsToRemove.has(h.id))
        );
      }

      // Enforce limits per table
      if (entry.tableName) {
        const tableHistory = allHistory.filter(
          (h: QueryHistoryEntry) =>
            h.connectionId === entry.connectionId &&
            h.tableName === entry.tableName
        );
        if (tableHistory.length > MAX_HISTORY_PER_TABLE) {
          // Remove oldest entries for this table
          const sortedByDate = tableHistory.sort(
            (a: QueryHistoryEntry, b: QueryHistoryEntry) =>
              new Date(a.lastExecutedAt).getTime() -
              new Date(b.lastExecutedAt).getTime()
          );
          const toRemove = sortedByDate.slice(
            0,
            tableHistory.length - MAX_HISTORY_PER_TABLE
          );
          const idsToRemove = new Set(
            toRemove.map((h: QueryHistoryEntry) => h.id)
          );
          allHistory.splice(
            0,
            allHistory.length,
            ...allHistory.filter(
              (h: QueryHistoryEntry) => !idsToRemove.has(h.id)
            )
          );
        }
      }

      robustStorage.set(QUERY_HISTORY_STORAGE_KEY, allHistory);
      return savedEntry;
    } catch (error) {
      console.error("Error saving query history:", error);
      throw error;
    }
  }

  /**
   * Delete a query from history
   */
  static deleteQuery(queryId: string): boolean {
    try {
      const history =
        robustStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const filteredHistory = history.filter(
        (entry: QueryHistoryEntry) => entry.id !== queryId
      );

      if (filteredHistory.length === history.length) {
        return false; // Query not found
      }

      robustStorage.set(QUERY_HISTORY_STORAGE_KEY, filteredHistory);
      return true;
    } catch (error) {
      console.error("Error deleting query history:", error);
      return false;
    }
  }

  /**
   * Clear all history for a connection
   */
  static clearHistory(connectionId: string): boolean {
    try {
      const history =
        robustStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const filteredHistory = history.filter(
        (entry: QueryHistoryEntry) => entry.connectionId !== connectionId
      );
      robustStorage.set(QUERY_HISTORY_STORAGE_KEY, filteredHistory);
      return true;
    } catch (error) {
      console.error("Error clearing query history:", error);
      return false;
    }
  }

  /**
   * Get most frequently executed queries for suggestions
   */
  static getMostFrequentQueries(
    connectionId: string,
    tableName?: string,
    limit: number = 10
  ): QueryHistoryEntry[] {
    const history = this.getHistory(connectionId, tableName);

    // Sort by execution count (descending) and then by last executed (descending)
    return history
      .sort((a, b) => {
        if (b.executionCount !== a.executionCount) {
          return b.executionCount - a.executionCount;
        }
        return (
          new Date(b.lastExecutedAt).getTime() -
          new Date(a.lastExecutedAt).getTime()
        );
      })
      .slice(0, limit);
  }

  /**
   * Generate a simple title from SQL query
   */
  static generateSimpleTitle(sql: string): string {
    const normalizedSql = sql.trim().toUpperCase();
    const originalSql = sql.trim().replace(/\s+/g, " "); // Normalize whitespace

    // Extract table name if possible
    const tableMatch =
      normalizedSql.match(/FROM\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i) ||
      normalizedSql.match(/UPDATE\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i) ||
      normalizedSql.match(
        /INSERT\s+INTO\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i
      ) ||
      normalizedSql.match(
        /DELETE\s+FROM\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i
      );

    const tableName = tableMatch ? tableMatch[2] || tableMatch[1] : "data";

    if (normalizedSql.startsWith("SELECT")) {
      // Extract columns being selected
      const selectMatch = originalSql.match(/SELECT\s+(.*?)\s+FROM/i);
      const columns = selectMatch ? selectMatch[1].trim() : "*";

      // Check for specific patterns and extract details
      if (
        normalizedSql.includes("COUNT(*)") ||
        normalizedSql.includes("COUNT(")
      ) {
        // Extract WHERE condition if exists
        const whereMatch = originalSql.match(
          /WHERE\s+(.*?)(?:ORDER|GROUP|LIMIT|$)/i
        );
        if (whereMatch) {
          const condition = whereMatch[1].trim().substring(0, 30);
          return `Count ${tableName} where ${condition}${
            condition.length > 30 ? "..." : ""
          }`;
        }
        return `Count all records in ${tableName}`;
      }

      // Check for WHERE clause with specific conditions
      if (normalizedSql.includes("WHERE")) {
        const whereMatch = originalSql.match(
          /WHERE\s+(.*?)(?:ORDER|GROUP|LIMIT|$)/i
        );
        if (whereMatch) {
          const condition = whereMatch[1].trim();
          // Extract first condition
          const firstCondition = condition.split(/AND|OR/i)[0].trim();
          const shortCondition =
            firstCondition.length > 40
              ? firstCondition.substring(0, 37) + "..."
              : firstCondition;
          return `${tableName}: ${shortCondition}`;
        }
        return `Filter ${tableName} records`;
      }

      // Check for JOIN
      if (normalizedSql.includes("JOIN")) {
        const joinMatch = originalSql.match(
          /JOIN\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i
        );
        const joinTable = joinMatch ? joinMatch[2] || joinMatch[1] : "table";
        return `${tableName} joined with ${joinTable}`;
      }

      // Check for ORDER BY
      if (normalizedSql.includes("ORDER BY")) {
        const orderMatch = originalSql.match(
          /ORDER BY\s+([\w,.\s]+?)(?:ASC|DESC|\s|LIMIT|$)/i
        );
        if (orderMatch) {
          const orderCol = orderMatch[1].trim().split(",")[0].trim();
          const direction = normalizedSql.includes("DESC") ? "desc" : "asc";
          return `${tableName} sorted by ${orderCol} (${direction})`;
        }
        return `${tableName} sorted`;
      }

      // Check for GROUP BY
      if (normalizedSql.includes("GROUP BY")) {
        const groupMatch = originalSql.match(
          /GROUP BY\s+([\w,.\s]+?)(?:HAVING|ORDER|LIMIT|$)/i
        );
        if (groupMatch) {
          const groupCol = groupMatch[1].trim().split(",")[0].trim();
          return `${tableName} grouped by ${groupCol}`;
        }
        return `${tableName} aggregated`;
      }

      // Check for LIMIT
      if (normalizedSql.includes("LIMIT")) {
        const limitMatch = originalSql.match(/LIMIT\s+(\d+)/i);
        const limit = limitMatch ? limitMatch[1] : "N";
        if (columns === "*") {
          return `First ${limit} records from ${tableName}`;
        }
        return `First ${limit} ${tableName} records`;
      }

      // Default select
      if (columns === "*") {
        return `All records from ${tableName}`;
      } else {
        const colList =
          columns.length > 30 ? columns.substring(0, 27) + "..." : columns;
        return `${tableName}: ${colList}`;
      }
    } else if (normalizedSql.startsWith("INSERT")) {
      return `Insert into ${tableName}`;
    } else if (normalizedSql.startsWith("UPDATE")) {
      return `Update ${tableName}`;
    } else if (normalizedSql.startsWith("DELETE")) {
      return `Delete from ${tableName}`;
    } else if (normalizedSql.startsWith("CREATE")) {
      return `Create ${tableName}`;
    } else if (normalizedSql.startsWith("DROP")) {
      return `Drop ${tableName}`;
    } else if (normalizedSql.startsWith("ALTER")) {
      return `Alter ${tableName}`;
    }

    return `Query ${tableName}`;
  }

  /**
   * Extract table name from SQL query
   */
  static extractTableName(sql: string): string | undefined {
    const normalizedSql = sql.trim();

    // Try to match common patterns
    const patterns = [
      /FROM\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i,
      /UPDATE\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i,
      /INSERT\s+INTO\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i,
      /DELETE\s+FROM\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/i,
    ];

    for (const pattern of patterns) {
      const match = normalizedSql.match(pattern);
      if (match) {
        // Return the table name (last captured group)
        return match[2] || match[1];
      }
    }

    return undefined;
  }

  /**
   * Update query title (e.g., with AI-generated title)
   */
  static updateQueryTitle(
    queryId: string,
    title: string,
    description?: string
  ): boolean {
    try {
      const history =
        robustStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const queryIndex = history.findIndex(
        (entry: QueryHistoryEntry) => entry.id === queryId
      );

      if (queryIndex === -1) {
        return false;
      }

      history[queryIndex] = {
        ...history[queryIndex],
        title,
        description: description || history[queryIndex].description,
      };

      robustStorage.set(QUERY_HISTORY_STORAGE_KEY, history);
      return true;
    } catch (error) {
      console.error("Error updating query title:", error);
      return false;
    }
  }

  /**
   * Ensure data migration has been performed
   */
  private static migrationChecked = false;

  static ensureMigration(): void {
    // Only check migration once per session to avoid performance impact
    if (QueryHistoryManager.migrationChecked) {
      return;
    }

    QueryHistoryManager.migrationChecked = true;

    try {
      if (!DataMigrationManager.isMigrationCompleted()) {
        console.log("Checking query history for migration...");
        const status = DataMigrationManager.getMigrationStatus();

        if (status.needsMigration) {
          console.warn(
            "Query history migration needed. Some history may be inaccessible until migration is performed."
          );
        }
      }
    } catch (error) {
      console.error("Error during query history migration check:", error);
    }
  }

  /**
   * Check data integrity of query history
   */
  static checkDataIntegrity(): {
    healthy: boolean;
    issues: string[];
    totalEntries: number;
    validEntries: number;
  } {
    try {
      const history =
        robustStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const issues: string[] = [];

      // Check for invalid entries
      const validEntries = history.filter((entry: QueryHistoryEntry) => {
        if (!entry.id || !entry.sql || !entry.connectionId) {
          return false;
        }
        return true;
      });

      const invalidCount = history.length - validEntries.length;
      if (invalidCount > 0) {
        issues.push(`${invalidCount} invalid query history entries found`);
      }

      // Check for orphaned entries (connections that no longer exist)
      // This would require importing ConnectionManager, so we'll skip for now

      return {
        healthy: issues.length === 0,
        issues,
        totalEntries: history.length,
        validEntries: validEntries.length,
      };
    } catch (error) {
      return {
        healthy: false,
        issues: [
          `Integrity check failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
        totalEntries: 0,
        validEntries: 0,
      };
    }
  }

  /**
   * Clean up invalid query history entries
   */
  static cleanupInvalidEntries(): {
    success: boolean;
    removedCount: number;
    message: string;
  } {
    try {
      const history =
        robustStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const validEntries = history.filter(
        (entry: QueryHistoryEntry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.sql === "string" &&
          typeof entry.connectionId === "string" &&
          entry.id.length > 0 &&
          entry.sql.length > 0 &&
          entry.connectionId.length > 0
      );

      const removedCount = history.length - validEntries.length;

      if (removedCount > 0) {
        robustStorage.set(QUERY_HISTORY_STORAGE_KEY, validEntries);
        return {
          success: true,
          removedCount,
          message: `Removed ${removedCount} invalid entries`,
        };
      }

      return {
        success: true,
        removedCount: 0,
        message: "No invalid entries found",
      };
    } catch (error) {
      return {
        success: false,
        removedCount: 0,
        message: `Cleanup failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }
}
