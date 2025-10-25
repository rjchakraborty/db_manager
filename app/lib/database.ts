import { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";
import {
  DatabaseConnection,
  DatabaseSchema,
  DatabaseTable,
  DatabaseColumn,
  QueryResult,
} from "@/types/database";
import net from "net";

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

    const pool = new Pool({
      host: effectiveHost,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      ssl: connection.ssl
        ? {
            rejectUnauthorized: false,
            // Support for RDS and other cloud providers
            checkServerIdentity: () => undefined,
          }
        : false,

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

    // Test the connection with increased timeout for tunnel connections
    const connectionTimeout = connection.requiresTunnel ? 30000 : 15000;
    const queryTimeout = connection.requiresTunnel ? 20000 : 10000;

    // If tunnel is required, verify tunnel is actually forwarding connections
    if (connection.requiresTunnel) {
      console.log(
        `⏳ Verifying tunnel connection before database connection...`
      );
      const tunnelReady = await verifyTunnelConnection(
        effectiveHost,
        connection.port
      );
      if (!tunnelReady) {
        throw new Error(
          "Tunnel connection verification failed. Please ensure the SSH tunnel is properly established and forwarding to localhost:" +
            connection.port
        );
      }
    }

    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Connection timeout")),
          connectionTimeout
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

// Helper function to verify tunnel is actually forwarding connections
async function verifyTunnelConnection(
  host: string,
  port: number,
  maxRetries: number = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isConnectable = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host, port, timeout: 2000 });

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
        console.log(`✅ Tunnel connection verified on attempt ${attempt}`);
        return true;
      }
    } catch {
      console.log(`⚠️ Tunnel verification attempt ${attempt} failed`);
    }

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  console.error(
    `❌ Failed to verify tunnel connection after ${maxRetries} attempts`
  );
  return false;
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

      // If tunnel is required, verify tunnel is actually forwarding connections
      if (connection.requiresTunnel) {
        console.log(
          `⏳ Verifying tunnel connection before testing database connection...`
        );
        const tunnelReady = await verifyTunnelConnection(
          effectiveHost,
          connection.port
        );
        if (!tunnelReady) {
          throw new Error(
            "Tunnel connection verification failed. Please ensure the SSH tunnel is properly established and forwarding to localhost:" +
              connection.port
          );
        }
      }

      // Adjust timeouts for tunnel connections
      const poolTimeout = connection.requiresTunnel ? 20000 : 10000;
      const connectTimeout = connection.requiresTunnel ? 18000 : 8000;
      const queryTimeout = connection.requiresTunnel ? 15000 : 5000;

      // Create a temporary pool just for testing
      testPool = new Pool({
        host: effectiveHost,
        port: connection.port,
        database: connection.database,
        user: connection.username,
        password: connection.password,
        ssl: connection.ssl
          ? {
              rejectUnauthorized: false,
              // Support for RDS and other cloud providers
              checkServerIdentity: () => undefined,
            }
          : false,
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
