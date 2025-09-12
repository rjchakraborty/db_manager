export interface DatabaseConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  createdAt: Date;
  isActive?: boolean;
}

export interface DatabaseSchema {
  schema_name: string;
  tables: DatabaseTable[];
}

export interface DatabaseTable {
  table_name: string;
  table_schema: string;
  columns: DatabaseColumn[];
  row_count?: number;
}

export interface DatabaseColumn {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  character_maximum_length: number | null;
  ordinal_position: number;
  is_primary_key?: boolean;
  is_foreign_key?: boolean;
  foreign_key_table?: string;
  foreign_key_column?: string;
}

export interface QueryResult {
  rows: any[];
  fields: {
    name: string;
    dataTypeID: number;
  }[];
  rowCount: number;
  command: string;
  duration: number;
}

export interface QueryError {
  message: string;
  code: string;
  detail?: string;
  hint?: string;
  position?: string;
  line?: number;
  column?: number;
}

export interface AIQueryRequest {
  naturalLanguage: string;
  context?: {
    tables: DatabaseTable[] | any[]; // Allow enhanced table format
    currentSchema: string;
    availableTables?: string[];
    tableNames?: string[]; // Add simple table names list
  };
}

export interface AIQueryResponse {
  sql: string;
  explanation: string;
  confidence: number;
  suggestions?: string[];
}

export type QueryMode = "sql" | "ai";

export interface QueryTab {
  id: string;
  name: string;
  query: string;
  mode: QueryMode;
  results?: QueryResult;
  error?: QueryError;
  isModified: boolean;
  isExecuting: boolean;
}
