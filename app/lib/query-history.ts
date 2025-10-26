import { secureStorage } from "./encryption";

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
      const stored = secureStorage.get<QueryHistoryEntry[]>(
        QUERY_HISTORY_STORAGE_KEY
      );
      let history = stored || [];

      if (connectionId) {
        history = history.filter(
          (entry) => entry.connectionId === connectionId
        );
      }

      if (tableName) {
        history = history.filter((entry) => entry.tableName === tableName);
      }

      // Sort by last executed date (most recent first)
      return history.sort(
        (a, b) =>
          new Date(b.lastExecutedAt).getTime() -
          new Date(a.lastExecutedAt).getTime()
      );
    } catch (error) {
      console.error("Error loading query history:", error);
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
        secureStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];

      // Normalize query for comparison (trim, lowercase, remove extra spaces)
      const normalizedSql = entry.sql.trim().toLowerCase().replace(/\s+/g, " ");

      // Check if this exact query already exists for this connection and table
      const existingIndex = allHistory.findIndex(
        (h) =>
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
        (h) => h.connectionId === entry.connectionId
      );
      if (connectionHistory.length > MAX_HISTORY_PER_CONNECTION) {
        // Remove oldest entries for this connection
        const sortedByDate = connectionHistory.sort(
          (a, b) =>
            new Date(a.lastExecutedAt).getTime() -
            new Date(b.lastExecutedAt).getTime()
        );
        const toRemove = sortedByDate.slice(
          0,
          connectionHistory.length - MAX_HISTORY_PER_CONNECTION
        );
        const idsToRemove = new Set(toRemove.map((h) => h.id));
        allHistory.splice(
          0,
          allHistory.length,
          ...allHistory.filter((h) => !idsToRemove.has(h.id))
        );
      }

      // Enforce limits per table
      if (entry.tableName) {
        const tableHistory = allHistory.filter(
          (h) =>
            h.connectionId === entry.connectionId &&
            h.tableName === entry.tableName
        );
        if (tableHistory.length > MAX_HISTORY_PER_TABLE) {
          // Remove oldest entries for this table
          const sortedByDate = tableHistory.sort(
            (a, b) =>
              new Date(a.lastExecutedAt).getTime() -
              new Date(b.lastExecutedAt).getTime()
          );
          const toRemove = sortedByDate.slice(
            0,
            tableHistory.length - MAX_HISTORY_PER_TABLE
          );
          const idsToRemove = new Set(toRemove.map((h) => h.id));
          allHistory.splice(
            0,
            allHistory.length,
            ...allHistory.filter((h) => !idsToRemove.has(h.id))
          );
        }
      }

      secureStorage.set(QUERY_HISTORY_STORAGE_KEY, allHistory);
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
        secureStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const filteredHistory = history.filter((entry) => entry.id !== queryId);

      if (filteredHistory.length === history.length) {
        return false; // Query not found
      }

      secureStorage.set(QUERY_HISTORY_STORAGE_KEY, filteredHistory);
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
        secureStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const filteredHistory = history.filter(
        (entry) => entry.connectionId !== connectionId
      );
      secureStorage.set(QUERY_HISTORY_STORAGE_KEY, filteredHistory);
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
        secureStorage.get<QueryHistoryEntry[]>(QUERY_HISTORY_STORAGE_KEY) || [];
      const queryIndex = history.findIndex((entry) => entry.id === queryId);

      if (queryIndex === -1) {
        return false;
      }

      history[queryIndex] = {
        ...history[queryIndex],
        title,
        description: description || history[queryIndex].description,
      };

      secureStorage.set(QUERY_HISTORY_STORAGE_KEY, history);
      return true;
    } catch (error) {
      console.error("Error updating query title:", error);
      return false;
    }
  }
}
