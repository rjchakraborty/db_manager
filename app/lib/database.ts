import { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";
import {
  DatabaseConnection,
  DatabaseSchema,
  DatabaseTable,
  DatabaseColumn,
  QueryResult,
} from "@/types/database";

// Singleton Pool Manager
class DatabasePoolManager {
  private static instance: DatabasePoolManager;
  private pools = new Map<string, Pool>();
  private configs = new Map<string, DatabaseConnection>();
  private health = new Map<
    string,
    { lastCheck: number; healthy: boolean; inUse: number }
  >();
  private recentlyCreated = new Map<string, number>();
  private schemaCache = new Map<
    string,
    { ts: number; data: DatabaseSchema[] }
  >();

  // Configuration constants
  private readonly SCHEMA_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly RECENT_CONNECTION_TTL_MS = 2 * 60 * 1000; // 2 minutes
  private readonly HEALTH_CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
  private readonly MAX_IDLE_TIME_MS = 10 * 60 * 1000; // 10 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanupTimer();
  }

  static getInstance(): DatabasePoolManager {
    if (!DatabasePoolManager.instance) {
      DatabasePoolManager.instance = new DatabasePoolManager();
    }
    return DatabasePoolManager.instance;
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.CLEANUP_INTERVAL_MS);
  }

  private async cleanupIdleConnections() {
    const now = Date.now();
    const connectionsToClose: string[] = [];

    for (const [connectionId, healthInfo] of this.health.entries()) {
      const isIdle = healthInfo.inUse === 0;
      const isOld = now - healthInfo.lastCheck > this.MAX_IDLE_TIME_MS;
      const isRecentlyCreated =
        this.recentlyCreated.has(connectionId) &&
        now - this.recentlyCreated.get(connectionId)! <
          this.RECENT_CONNECTION_TTL_MS;

      if (isIdle && isOld && !isRecentlyCreated) {
        connectionsToClose.push(connectionId);
      }
    }

    for (const connectionId of connectionsToClose) {
      console.log(`🧹 Cleaning up idle connection: ${connectionId}`);
      await this.closeConnection(connectionId, false);
    }
  }

  async createPool(connection: DatabaseConnection): Promise<Pool> {
    const connectionId = connection.id;

    // Debug logging
    console.log("🔧 Creating pool with config:", {
      connectionId,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      requiresTunnel: connection.requiresTunnel,
      ssl: connection.ssl,
    });

    // Store config first
    this.configs.set(connectionId, connection);

    // Close existing pool if it exists
    if (this.pools.has(connectionId)) {
      await this.closeConnection(connectionId, false);
    }

    // Use localhost if tunnel is required, otherwise use the original host
    const effectiveHost = connection.requiresTunnel
      ? "localhost"
      : connection.host;

    // Force SSL for tunnel connections (RDS requires SSL even through SSH tunnel)
    // This matches the behavior of migration scripts which use sslmode=require
    const effectiveSSL = connection.requiresTunnel
      ? {
          rejectUnauthorized: false,
          // Support for RDS and other cloud providers
          checkServerIdentity: () => undefined,
        }
      : connection.ssl
      ? {
          rejectUnauthorized: false,
          // Support for RDS and other cloud providers
          checkServerIdentity: () => undefined,
        }
      : false;

    const pool = new Pool({
      host: effectiveHost,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      ssl: effectiveSSL,

      // Optimized pool settings for stability
      max: 3, // Smaller pool size for better resource management
      min: 0, // Allow pool to scale down to 0 when idle
      connectionTimeoutMillis: 20000, // Increased timeout
      idleTimeoutMillis: 30000, // Keep connections alive for 30 seconds
      allowExitOnIdle: false, // Don't exit on idle

      // Connection validation
      statement_timeout: 30000, // 30 second query timeout
      query_timeout: 30000,
    });

    // Set up pool event handlers
    pool.on("error", (err) => {
      console.error(`Pool error for ${connectionId}:`, err);
      this.health.set(connectionId, {
        lastCheck: Date.now(),
        healthy: false,
        inUse: this.health.get(connectionId)?.inUse || 0,
      });
    });

    pool.on("connect", () => {
      console.log(`✅ Pool connected for ${connectionId}`);
    });

    pool.on("acquire", () => {
      const current = this.health.get(connectionId);
      this.health.set(connectionId, {
        lastCheck: Date.now(),
        healthy: current?.healthy ?? true,
        inUse: (current?.inUse || 0) + 1,
      });
    });

    pool.on("release", () => {
      const current = this.health.get(connectionId);
      this.health.set(connectionId, {
        lastCheck: Date.now(),
        healthy: current?.healthy ?? true,
        inUse: Math.max(0, (current?.inUse || 1) - 1),
      });
    });

    // Dynamic tunnel verification and timeout calculation
    let tunnelWaitTime = 0;
    if (connection.requiresTunnel) {
      const tunnelStartTime = Date.now();
      console.log(
        `⏳ Waiting for tunnel to be ready before database connection...`
      );
      const tunnelReady = await waitForTunnelReady(
        effectiveHost,
        connection.port
      );
      tunnelWaitTime = Date.now() - tunnelStartTime;

      if (!tunnelReady) {
        throw new Error(
          `Tunnel connection not available after ${tunnelWaitTime}ms. ` +
            `Please ensure the SSH tunnel is properly established and forwarding to localhost:${connection.port}`
        );
      }
    }

    // Calculate dynamic timeouts based on connection type and tunnel wait time
    const connectionTimeout = calculateDynamicTimeout(
      connection.requiresTunnel ?? false,
      "connection",
      tunnelWaitTime
    );
    const queryTimeout = calculateDynamicTimeout(
      connection.requiresTunnel ?? false,
      "query",
      tunnelWaitTime
    );

    console.log(
      `⏱️ Using timeouts - connection: ${connectionTimeout}ms, query: ${queryTimeout}ms`
    );

    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Connection timeout after ${connectionTimeout}ms`)
            ),
          connectionTimeout
        )
      ),
    ]);

    await Promise.race([
      client.query("SELECT 1"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Query timeout after ${queryTimeout}ms`)),
          queryTimeout
        )
      ),
    ]);

    client.release();

    // Store the pool and mark as healthy
    this.pools.set(connectionId, pool);
    this.recentlyCreated.set(connectionId, Date.now());
    this.health.set(connectionId, {
      lastCheck: Date.now(),
      healthy: true,
      inUse: 0,
    });

    console.log(`✅ Pool created successfully for ${connectionId}`);
    return pool;
  }

  async getPool(connectionId: string): Promise<Pool> {
    let pool = this.pools.get(connectionId);

    if (pool) {
      const health = this.health.get(connectionId);
      const isRecentlyCreated =
        this.recentlyCreated.has(connectionId) &&
        Date.now() - this.recentlyCreated.get(connectionId)! <
          this.RECENT_CONNECTION_TTL_MS;

      // Skip health check for recently created connections
      if (isRecentlyCreated) {
        return pool;
      }

      // Check if we need a health check
      const needsHealthCheck =
        !health ||
        Date.now() - health.lastCheck > this.HEALTH_CHECK_INTERVAL_MS ||
        !health.healthy;

      if (needsHealthCheck) {
        const isHealthy = await this.checkPoolHealth(connectionId, pool);
        if (!isHealthy) {
          pool = undefined;
        }
      }
    }

    if (!pool) {
      const config = this.configs.get(connectionId);
      if (!config) {
        throw new Error(
          `No configuration found for connection: ${connectionId}`
        );
      }
      pool = await this.createPool(config);
    }

    return pool;
  }

  private async checkPoolHealth(
    connectionId: string,
    pool: Pool
  ): Promise<boolean> {
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 5000)
        ),
      ]);

      await Promise.race([
        client.query("SELECT 1"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health query timeout")), 3000)
        ),
      ]);

      client.release();

      // Update health status
      const current = this.health.get(connectionId);
      this.health.set(connectionId, {
        lastCheck: Date.now(),
        healthy: true,
        inUse: current?.inUse || 0,
      });

      return true;
    } catch (error) {
      console.log(
        `❌ Health check failed for ${connectionId}:`,
        error instanceof Error ? error.message : "Unknown error"
      );

      // Mark as unhealthy and close the pool
      this.health.set(connectionId, {
        lastCheck: Date.now(),
        healthy: false,
        inUse: 0,
      });

      await this.closeConnection(connectionId, false);
      return false;
    }
  }

  async closeConnection(
    connectionId: string,
    removeConfig: boolean = false
  ): Promise<void> {
    const pool = this.pools.get(connectionId);
    if (pool) {
      try {
        await pool.end();
        console.log(`🔌 Pool closed for ${connectionId}`);
      } catch (error) {
        console.warn(`Warning: Error closing pool for ${connectionId}:`, error);
      }

      this.pools.delete(connectionId);
      this.health.delete(connectionId);
      this.recentlyCreated.delete(connectionId);
    }

    if (removeConfig) {
      this.configs.delete(connectionId);
    }
  }

  async closeAllConnections(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const closePromises = Array.from(this.pools.keys()).map((id) =>
      this.closeConnection(id, true)
    );

    await Promise.all(closePromises);
    this.schemaCache.clear();
  }

  // Schema cache methods
  getCachedSchema(
    connectionId: string
  ): { ts: number; data: DatabaseSchema[] } | null {
    const cached = this.schemaCache.get(connectionId);
    if (!cached) return null;

    const isExpired = Date.now() - cached.ts > this.SCHEMA_CACHE_TTL_MS;
    if (isExpired) {
      this.schemaCache.delete(connectionId);
      return null;
    }

    return cached;
  }

  setCachedSchema(connectionId: string, data: DatabaseSchema[]): void {
    this.schemaCache.set(connectionId, {
      ts: Date.now(),
      data,
    });
  }

  getConnectionConfig(connectionId: string): DatabaseConnection | undefined {
    return this.configs.get(connectionId);
  }

  setConnectionConfig(connectionId: string, config: DatabaseConnection): void {
    this.configs.set(connectionId, config);
  }
}

// Global instance
const poolManager = DatabasePoolManager.getInstance();

// Dynamic timeout configuration based on connection type
const TIMEOUT_CONFIG = {
  direct: {
    connection: 15000,
    query: 10000,
    pool: 10000,
  },
  tunnel: {
    // Base timeouts for tunnel connections
    base: {
      connection: 20000,
      query: 15000,
      pool: 15000,
    },
    // Per-attempt timeout for tunnel verification
    verifyAttempt: 2000,
    // Maximum time to wait for tunnel to become available
    maxWaitTime: 30000,
    // Polling interval for tunnel checks
    pollInterval: 1000,
  },
};

/**
 * Dynamically waits for tunnel to be ready with polling mechanism
 * Similar to the pattern in run_migration.sh (lines 71-82)
 */
async function waitForTunnelReady(
  host: string,
  port: number
): Promise<boolean> {
  const net = require("net");
  const startTime = Date.now();
  const maxWaitTime = TIMEOUT_CONFIG.tunnel.maxWaitTime;
  const pollInterval = TIMEOUT_CONFIG.tunnel.pollInterval;

  let attempt = 0;
  console.log(`⏳ Waiting for tunnel to be ready at ${host}:${port}...`);

  while (Date.now() - startTime < maxWaitTime) {
    attempt++;

    try {
      const isConnectable = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({
          host,
          port,
          timeout: TIMEOUT_CONFIG.tunnel.verifyAttempt,
        });

        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve(false);
        });

        socket.on("error", () => {
          socket.destroy();
          resolve(false);
        });
      });

      if (isConnectable) {
        const elapsedTime = Date.now() - startTime;
        console.log(
          `✅ Tunnel ready after ${elapsedTime}ms (${attempt} attempts)`
        );
        // Give tunnel a bit more time to stabilize (similar to run_migration.sh line 76)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return true;
      }
    } catch (error) {
      // Continue polling
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  const elapsedTime = Date.now() - startTime;
  console.error(
    `❌ Tunnel not ready after ${elapsedTime}ms (${attempt} attempts)`
  );
  return false;
}

/**
 * Calculate dynamic timeout based on connection type and elapsed wait time
 */
function calculateDynamicTimeout(
  requiresTunnel: boolean,
  timeoutType: "connection" | "query" | "pool",
  tunnelWaitTime: number = 0
): number {
  if (!requiresTunnel) {
    return TIMEOUT_CONFIG.direct[timeoutType];
  }

  // For tunnel connections, adjust timeout based on how long we waited for tunnel
  // If tunnel took a while to establish, reduce the timeout slightly to fail faster
  const baseTimeout = TIMEOUT_CONFIG.tunnel.base[timeoutType];
  const adjustment = Math.min(tunnelWaitTime * 0.3, baseTimeout * 0.3); // Max 30% reduction

  return Math.max(baseTimeout - adjustment, baseTimeout * 0.5); // Never go below 50% of base
}

export class DatabaseService {
  static async testConnection(
    connection: DatabaseConnection
  ): Promise<boolean> {
    let testPool: Pool | null = null;
    let client: PoolClient | null = null;

    try {
      // Use localhost if tunnel is required, otherwise use the original host
      const effectiveHost = connection.requiresTunnel
        ? "localhost"
        : connection.host;

      // Dynamic tunnel verification and timeout calculation
      let tunnelWaitTime = 0;
      if (connection.requiresTunnel) {
        const tunnelStartTime = Date.now();
        console.log(
          `⏳ Waiting for tunnel to be ready before testing database connection...`
        );
        const tunnelReady = await waitForTunnelReady(
          effectiveHost,
          connection.port
        );
        tunnelWaitTime = Date.now() - tunnelStartTime;

        if (!tunnelReady) {
          throw new Error(
            `Tunnel connection not available after ${tunnelWaitTime}ms. ` +
              `Please ensure the SSH tunnel is properly established and forwarding to localhost:${connection.port}`
          );
        }
      }

      // Calculate dynamic timeouts based on connection type and tunnel wait time
      const poolTimeout = calculateDynamicTimeout(
        connection.requiresTunnel ?? false,
        "pool",
        tunnelWaitTime
      );
      const connectTimeout = calculateDynamicTimeout(
        connection.requiresTunnel ?? false,
        "connection",
        tunnelWaitTime
      );
      const queryTimeout = calculateDynamicTimeout(
        connection.requiresTunnel ?? false,
        "query",
        tunnelWaitTime
      );

      console.log(
        `⏱️ Using timeouts - pool: ${poolTimeout}ms, connection: ${connectTimeout}ms, query: ${queryTimeout}ms`
      );

      // Force SSL for tunnel connections (RDS requires SSL even through SSH tunnel)
      // This matches the behavior of migration scripts which use sslmode=require
      const effectiveSSL = connection.requiresTunnel
        ? {
            rejectUnauthorized: false,
            // Support for RDS and other cloud providers
            checkServerIdentity: () => undefined,
          }
        : connection.ssl
        ? {
            rejectUnauthorized: false,
            // Support for RDS and other cloud providers
            checkServerIdentity: () => undefined,
          }
        : false;

      // Create a temporary pool just for testing
      testPool = new Pool({
        host: effectiveHost,
        port: connection.port,
        database: connection.database,
        user: connection.username,
        password: connection.password,
        ssl: effectiveSSL,
        connectionTimeoutMillis: poolTimeout,
        idleTimeoutMillis: 5000,
        max: 1, // Single connection for testing
      });

      client = await Promise.race([
        testPool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Connection timeout")),
            connectTimeout
          )
        ),
      ]);

      await Promise.race([
        client.query("SELECT 1"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Query timeout")), queryTimeout)
        ),
      ]);

      client.release();
      await testPool.end();

      return true;
    } catch (error) {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.warn("Error releasing test client:", releaseError);
        }
      }
      if (testPool) {
        try {
          await testPool.end();
        } catch (endError) {
          console.warn("Error ending test pool:", endError);
        }
      }
      console.error("Database connection test failed:", error);
      return false;
    }
  }

  static async testAndCreateConnection(
    connection: DatabaseConnection
  ): Promise<boolean> {
    try {
      // First test the connection
      const testResult = await this.testConnection(connection);
      if (!testResult) {
        return false;
      }

      // If test succeeds, create the persistent connection using pool manager
      await poolManager.createPool(connection);
      return true;
    } catch (error) {
      console.error("Database connection test and create failed:", error);
      return false;
    }
  }

  static async createConnection(connection: DatabaseConnection): Promise<Pool> {
    return await poolManager.createPool(connection);
  }

  static async closeConnection(
    connectionId: string,
    removeConfig: boolean = false
  ): Promise<void> {
    await poolManager.closeConnection(connectionId, removeConfig);
  }

  static async getOrCreateConnection(connectionId: string): Promise<Pool> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        return await poolManager.getPool(connectionId);
      } catch (error: unknown) {
        retryCount++;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(
          `Connection attempt ${retryCount} failed for ${connectionId}:`,
          errorMessage
        );

        if (retryCount >= maxRetries) {
          throw new Error(
            `Failed to establish database connection after ${maxRetries} attempts: ${errorMessage}`
          );
        }

        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000)
        );
      }
    }

    throw new Error("Unexpected error in connection retry loop");
  }

  static async executeQuery(
    connectionId: string,
    query: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    try {
      const pool = await this.getOrCreateConnection(connectionId);
      const startTime = Date.now();

      const result: PgQueryResult = params
        ? await pool.query(query, params)
        : await pool.query(query);
      const duration = Date.now() - startTime;

      return {
        rows: result.rows,
        fields: result.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
        rowCount: result.rowCount || 0,
        command: result.command || "",
        duration,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Query execution failed";
      console.error(
        `Query execution failed for connection ${connectionId}:`,
        errorMessage
      );
      const pgError = error as {
        code?: string;
        detail?: string;
        hint?: string;
        position?: string;
        line?: number;
        column?: number;
      };
      throw {
        message: errorMessage,
        code: pgError.code || "UNKNOWN",
        detail: pgError.detail,
        hint: pgError.hint,
        position: pgError.position,
        line: pgError.line,
        column: pgError.column,
      };
    }
  }

  static async getSchemas(connectionId: string): Promise<string[]> {
    const query = `
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name;
    `;

    const result = await this.executeQuery(connectionId, query);
    return result.rows.map(
      (row) => (row as { schema_name: string }).schema_name
    );
  }

  static async getTables(
    connectionId: string,
    schemaName: string
  ): Promise<DatabaseTable[]> {
    // Get all tables first
    const tablesQuery = `
      SELECT 
        t.table_name,
        t.table_schema,
        COALESCE(s.n_tup_ins + s.n_tup_upd + s.n_tup_del, 0) as row_count
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = t.table_schema
      WHERE t.table_schema = '${schemaName.replace(/'/g, "''")}'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name;
    `;

    const tablesResult = await this.executeQuery(connectionId, tablesQuery);

    // Get all columns for all tables in one query - MUCH more efficient!
    const columnsQuery = `
      SELECT 
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable::boolean,
        c.column_default,
        c.character_maximum_length,
        c.ordinal_position,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
        fk.foreign_table_name as foreign_key_table,
        fk.foreign_column_name as foreign_key_column
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE tc.table_schema = '${schemaName.replace(
          /'/g,
          "''"
        )}' AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
      LEFT JOIN (
        SELECT 
          ku.table_name,
          ku.column_name,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = '${schemaName.replace(
          /'/g,
          "''"
        )}' AND tc.constraint_type = 'FOREIGN KEY'
      ) fk ON c.table_name = fk.table_name AND c.column_name = fk.column_name
      WHERE c.table_schema = '${schemaName.replace(/'/g, "''")}'
      ORDER BY c.table_name, c.ordinal_position;
    `;

    const columnsResult = await this.executeQuery(connectionId, columnsQuery);

    // Group columns by table name
    const columnsByTable = new Map<string, DatabaseColumn[]>();
    for (const row of columnsResult.rows) {
      const typedRow = row as {
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: boolean | string;
        column_default: string | null;
        character_maximum_length: number | null;
        ordinal_position: number;
        is_primary_key: boolean;
        is_foreign_key: boolean;
        foreign_key_table: string | null;
        foreign_key_column: string | null;
      };
      const tableName = typedRow.table_name;
      if (!columnsByTable.has(tableName)) {
        columnsByTable.set(tableName, []);
      }
      columnsByTable.get(tableName)!.push({
        column_name: typedRow.column_name,
        data_type: typedRow.data_type,
        is_nullable:
          typedRow.is_nullable === true || typedRow.is_nullable === "YES",
        column_default: typedRow.column_default,
        character_maximum_length: typedRow.character_maximum_length,
        ordinal_position: Number(typedRow.ordinal_position) || 0,
        is_primary_key: typedRow.is_primary_key === true,
        is_foreign_key: typedRow.is_foreign_key === true,
        foreign_key_table: typedRow.foreign_key_table || undefined,
        foreign_key_column: typedRow.foreign_key_column || undefined,
      });
    }

    // Build final tables array
    const tables: DatabaseTable[] = [];
    for (const row of tablesResult.rows) {
      const typedTableRow = row as {
        table_name: string;
        table_schema: string;
        row_count: string;
      };
      const columns = columnsByTable.get(typedTableRow.table_name) || [];
      tables.push({
        table_name: typedTableRow.table_name,
        table_schema: typedTableRow.table_schema,
        columns,
        row_count: parseInt(typedTableRow.row_count) || 0,
      });
    }

    return tables;
  }

  static async getTableColumns(
    connectionId: string,
    schemaName: string,
    tableName: string
  ): Promise<DatabaseColumn[]> {
    // Use safe string interpolation instead of parameterized queries
    const escapedSchema = schemaName.replace(/'/g, "''");
    const escapedTable = tableName.replace(/'/g, "''");

    const query = `
      SELECT 
        c.column_name,
        c.data_type,
        c.is_nullable::boolean,
        c.column_default,
        c.character_maximum_length,
        c.ordinal_position,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
        fk.foreign_table_name as foreign_key_table,
        fk.foreign_column_name as foreign_key_column
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        WHERE tc.table_schema = '${escapedSchema}' AND tc.table_name = '${escapedTable}' AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.column_name = pk.column_name
      LEFT JOIN (
        SELECT 
          ku.column_name,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = '${escapedSchema}' AND tc.table_name = '${escapedTable}' AND tc.constraint_type = 'FOREIGN KEY'
      ) fk ON c.column_name = fk.column_name
      WHERE c.table_schema = '${escapedSchema}' AND c.table_name = '${escapedTable}'
      ORDER BY c.ordinal_position;
    `;

    const result = await this.executeQuery(connectionId, query);
    return result.rows.map((row): DatabaseColumn => {
      const typedRow = row as {
        column_name: string;
        data_type: string;
        is_nullable: boolean | string;
        column_default: string | null;
        character_maximum_length: number | null;
        ordinal_position: number | string;
        is_primary_key: boolean;
        is_foreign_key: boolean;
        foreign_key_table: string | null;
        foreign_key_column: string | null;
      };
      return {
        column_name: typedRow.column_name,
        data_type: typedRow.data_type,
        is_nullable:
          typedRow.is_nullable === true || typedRow.is_nullable === "YES",
        column_default: typedRow.column_default,
        character_maximum_length: typedRow.character_maximum_length,
        ordinal_position: Number(typedRow.ordinal_position) || 0,
        is_primary_key: typedRow.is_primary_key === true,
        is_foreign_key: typedRow.is_foreign_key === true,
        foreign_key_table: typedRow.foreign_key_table || undefined,
        foreign_key_column: typedRow.foreign_key_column || undefined,
      };
    });
  }

  static async getFullSchema(connectionId: string): Promise<DatabaseSchema[]> {
    // Check cache first using pool manager
    const cached = poolManager.getCachedSchema(connectionId);
    if (cached) {
      return cached.data;
    }

    const schemaNames = await this.getSchemas(connectionId);

    const schemas: DatabaseSchema[] = [];

    for (let i = 0; i < schemaNames.length; i++) {
      const schemaName = schemaNames[i];
      const tables = await this.getTables(connectionId, schemaName);
      schemas.push({ schema_name: schemaName, tables });
    }

    // Cache using pool manager
    poolManager.setCachedSchema(connectionId, schemas);
    return schemas;
  }

  static async getTableData(
    connectionId: string,
    schemaName: string,
    tableName: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<QueryResult> {
    const query = `SELECT * FROM "${schemaName}"."${tableName}" LIMIT ${limit} OFFSET ${offset}`;
    return this.executeQuery(connectionId, query);
  }

  static async getTableRowCount(
    connectionId: string,
    schemaName: string,
    tableName: string
  ): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM "${schemaName}"."${tableName}"`;
    const result = await this.executeQuery(connectionId, query);
    return parseInt((result.rows[0] as { count: string }).count) || 0;
  }

  // Cleanup all connections when the app is closing
  static async closeAllConnections(): Promise<void> {
    await poolManager.closeAllConnections();
  }
}
