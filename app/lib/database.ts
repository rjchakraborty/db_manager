import { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";
import {
  DatabaseConnection,
  DatabaseSchema,
  DatabaseTable,
  DatabaseColumn,
  QueryResult,
} from "@/types/database";

// Store active connections and their configurations
const activeConnections = new Map<string, Pool>();
const connectionConfigs = new Map<string, DatabaseConnection>();
const schemaCache = new Map<string, { ts: number; data: DatabaseSchema[] }>();
const recentlyCreated = new Map<string, number>(); // Track recently created connections
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RECENT_CONNECTION_TTL_MS = 30 * 1000; // 30 seconds

export class DatabaseService {
  static async testConnection(
    connection: DatabaseConnection
  ): Promise<boolean> {
    let client: PoolClient | null = null;

    try {
      const pool = new Pool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.username,
        password: connection.password,
        ssl: connection.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        max: 1, // Limit connections for testing
      });

      client = await pool.connect();
      await client.query("SELECT 1");

      client.release();
      await pool.end();

      return true;
    } catch (error) {
      if (client) {
        client.release();
      }
      console.error("Database connection test failed:", error);
      return false;
    }
  }

  static async testAndCreateConnection(
    connection: DatabaseConnection
  ): Promise<boolean> {
    try {
      // First test the connection with a temporary pool
      const testPool = new Pool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.username,
        password: connection.password,
        ssl: connection.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        max: 1,
      });

      const client = await testPool.connect();
      await client.query("SELECT 1");
      client.release();
      await testPool.end();

      // If test succeeds, create the persistent connection
      await this.createConnection(connection);
      return true;
    } catch (error) {
      console.error("Database connection test and create failed:", error);
      return false;
    }
  }

  static async createConnection(connection: DatabaseConnection): Promise<Pool> {
    try {

      // Store config FIRST before any operations
      connectionConfigs.set(connection.id, connection);

      // Close existing connection if it exists (but keep config)
      if (activeConnections.has(connection.id)) {
        const existingPool = activeConnections.get(connection.id);
        if (existingPool) {
          await existingPool.end();
          activeConnections.delete(connection.id);
          // Don't delete config here - we need it!
        }
      }

      const pool = new Pool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.username,
        password: connection.password,
        ssl: connection.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10, // Maximum number of clients in the pool
      });

      // Test the connection
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();

      activeConnections.set(connection.id, pool);
      recentlyCreated.set(connection.id, Date.now()); // Mark as recently created

      return pool;
    } catch (error) {
      console.error("Failed to create database connection:", error);
      // Remove config if connection creation failed
      connectionConfigs.delete(connection.id);
      throw error;
    }
  }

  static async closeConnection(connectionId: string, removeConfig: boolean = false): Promise<void> {
    const pool = activeConnections.get(connectionId);
    if (pool) {
      await pool.end();
      activeConnections.delete(connectionId);
      recentlyCreated.delete(connectionId); // Clean up tracking
      if (removeConfig) {
        connectionConfigs.delete(connectionId);
      }
    }
  }

  static async getOrCreateConnection(connectionId: string): Promise<Pool> {

    // Check if we have an active connection
    let pool = activeConnections.get(connectionId);

    // Test if the pool is still healthy (but skip for recently created connections)
    if (pool) {
      const createdTime = recentlyCreated.get(connectionId);
      const isRecentlyCreated = createdTime && (Date.now() - createdTime) < RECENT_CONNECTION_TTL_MS;

      if (isRecentlyCreated) {
        return pool; // Skip health check for recently created connections
      }

      try {
        // Quick health check - if this fails, the pool is ended/unhealthy
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        return pool;
      } catch (error: any) {
        console.log(`❌ Health check failed for ${connectionId}:`, error.message);
        activeConnections.delete(connectionId);
        recentlyCreated.delete(connectionId); // Clean up tracking
        pool = undefined;
      }
    }

    if (!pool) {
      // Try to recreate connection from stored config
      const config = connectionConfigs.get(connectionId);
      if (config) {
        pool = await this.createConnection(config);
      } else {
        console.log(`❌ No stored config found for: ${connectionId}`);
      }
    }

    if (!pool) {
      throw new Error(
        "No active connection found and no stored configuration available"
      );
    }

    return pool;
  }

  static getConnection(connectionId: string): Pool | null {
    const connection = activeConnections.get(connectionId) || null;
    return connection;
  }

  static async executeQuery(
    connectionId: string,
    query: string,
    params?: any[]
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
    } catch (error: any) {
      console.error(`Query execution failed for connection ${connectionId}:`, error.message);
      throw {
        message: error.message || "Query execution failed",
        code: error.code || "UNKNOWN",
        detail: error.detail,
        hint: error.hint,
        position: error.position,
        line: error.line,
        column: error.column,
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
    return result.rows.map((row: any) => row.schema_name);
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
        WHERE tc.table_schema = '${schemaName.replace(/'/g, "''")}' AND tc.constraint_type = 'PRIMARY KEY'
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
        WHERE tc.table_schema = '${schemaName.replace(/'/g, "''")}' AND tc.constraint_type = 'FOREIGN KEY'
      ) fk ON c.table_name = fk.table_name AND c.column_name = fk.column_name
      WHERE c.table_schema = '${schemaName.replace(/'/g, "''")}'
      ORDER BY c.table_name, c.ordinal_position;
    `;

    const columnsResult = await this.executeQuery(connectionId, columnsQuery);

    // Group columns by table name
    const columnsByTable = new Map<string, DatabaseColumn[]>();
    for (const row of columnsResult.rows) {
      const tableName = row.table_name;
      if (!columnsByTable.has(tableName)) {
        columnsByTable.set(tableName, []);
      }
      columnsByTable.get(tableName)!.push({
        column_name: row.column_name,
        data_type: row.data_type,
        is_nullable: row.is_nullable,
        column_default: row.column_default,
        character_maximum_length: row.character_maximum_length,
        ordinal_position: row.ordinal_position,
        is_primary_key: row.is_primary_key,
        is_foreign_key: row.is_foreign_key,
        foreign_key_table: row.foreign_key_table,
        foreign_key_column: row.foreign_key_column,
      });
    }

    // Build final tables array
    const tables: DatabaseTable[] = [];
    for (const row of tablesResult.rows) {
      const columns = columnsByTable.get(row.table_name) || [];
      tables.push({
        table_name: row.table_name,
        table_schema: row.table_schema,
        columns,
        row_count: parseInt(row.row_count) || 0,
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
    return result.rows.map((row: any) => ({
      column_name: row.column_name,
      data_type: row.data_type,
      is_nullable: row.is_nullable,
      column_default: row.column_default,
      character_maximum_length: row.character_maximum_length,
      ordinal_position: row.ordinal_position,
      is_primary_key: row.is_primary_key,
      is_foreign_key: row.is_foreign_key,
      foreign_key_table: row.foreign_key_table,
      foreign_key_column: row.foreign_key_column,
    }));
  }

  static async getFullSchema(
    connectionId: string
  ): Promise<DatabaseSchema[]> {
    // Serve from cache when fresh
    const cached = schemaCache.get(connectionId);
    const now = Date.now();
    if (cached && now - cached.ts < SCHEMA_CACHE_TTL_MS) {
      return cached.data;
    }

    const schemaNames = await this.getSchemas(connectionId);

    const schemas: DatabaseSchema[] = [];

    for (let i = 0; i < schemaNames.length; i++) {
      const schemaName = schemaNames[i];
      const tables = await this.getTables(connectionId, schemaName);
      schemas.push({ schema_name: schemaName, tables });
    }

    schemaCache.set(connectionId, { ts: now, data: schemas });
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
    return parseInt(result.rows[0].count) || 0;
  }

  // Cleanup all connections when the app is closing
  static async closeAllConnections(): Promise<void> {
    const promises = Array.from(activeConnections.keys()).map((id) =>
      this.closeConnection(id, true) // Remove configs when closing all
    );
    await Promise.all(promises);
  }
}
