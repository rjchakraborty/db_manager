"use client";

import React, { useState, useEffect, useCallback } from "react";
import DatabaseNavigator from "@/components/database/database-navigator";
import TableViewer from "@/components/database/table-viewer";
import EnhancedAIAssistant from "@/components/ai-assistant/enhanced-ai-assistant";
import SettingsModal from "@/components/settings/settings-modal";
import DataViewer from "@/components/ui/data-viewer";
import {
  DatabaseConnection,
  DatabaseTable,
  QueryResult,
  DatabaseColumn,
} from "@/types/database";
import { Settings, Menu, X, RefreshCw } from "lucide-react";
import { ConnectionManager } from "@/lib/connection-manager";
import { ResizablePanel } from "@/components/ui/resizable-panel";
import { QueryHistoryManager } from "@/lib/query-history";
import { secureStorage } from "@/lib/encryption";

export default function Home() {
  const [selectedConnection, setSelectedConnection] =
    useState<DatabaseConnection | null>(null);
  const [, setConnections] = useState<DatabaseConnection[]>([]);
  const [selectedTable, setSelectedTable] = useState<{
    schema: string;
    table: string;
  } | null>(null);
  const [currentSchema, setCurrentSchema] = useState("public");
  const [availableTables, setAvailableTables] = useState<DatabaseTable[]>([]);
  const [fullSchema, setFullSchema] = useState<
    { schema_name: string; tables: DatabaseTable[] }[]
  >([]);
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(true);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [schemaCache, setSchemaCache] = useState<
    Map<
      string,
      {
        schemas: { schema_name: string; tables: DatabaseTable[] }[];
        timestamp: number;
        tables: DatabaseTable[];
      }
    >
  >(new Map());
  const [dataViewer, setDataViewer] = useState<{
    isVisible: boolean;
    data: unknown;
    dataType: string;
    columnName: string;
    tableName?: string;
    column?: DatabaseColumn;
    rowIndex: number;
  }>({
    isVisible: false,
    data: null,
    dataType: "text",
    columnName: "",
    rowIndex: -1,
  });

  // Load connections and auto-connect on page load
  useEffect(() => {
    loadConnections();
    loadSchemaCache();
    autoConnectDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConnections = () => {
    const allConnections = ConnectionManager.getAllConnections();
    setConnections(allConnections);
  };

  const loadSchemaCache = () => {
    try {
      const cached = localStorage.getItem("db-schema-cache");
      if (cached) {
        const parsedCache = JSON.parse(cached);
        const cacheMap = new Map();
        Object.entries(parsedCache).forEach(
          ([key, value]: [string, unknown]) => {
            cacheMap.set(key, value);
          }
        );
        setSchemaCache(cacheMap);
      }
    } catch (error) {
      console.error("Error loading schema cache:", error);
    }
  };

  const saveSchemaCache = (
    connectionId: string,
    schemas: { schema_name: string; tables: DatabaseTable[] }[],
    tables: DatabaseTable[]
  ) => {
    try {
      const newCache = new Map(schemaCache);
      newCache.set(connectionId, {
        schemas,
        tables,
        timestamp: Date.now(),
      });

      setSchemaCache(newCache);

      // Save to localStorage
      const cacheObject = Object.fromEntries(newCache);
      localStorage.setItem("db-schema-cache", JSON.stringify(cacheObject));
    } catch (error) {
      console.error("Error saving schema cache:", error);
    }
  };

  const getCachedSchema = (
    connectionId: string
  ): {
    schemas: { schema_name: string; tables: DatabaseTable[] }[];
    tables: DatabaseTable[];
  } | null => {
    const cached = schemaCache.get(connectionId);
    if (!cached) return null;

    // Check if cache is still fresh (24 hours)
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    const isExpired = Date.now() - cached.timestamp > CACHE_TTL;

    if (isExpired) {
      return null;
    }

    return { schemas: cached.schemas, tables: cached.tables };
  };

  const connectToDatabase = async (
    connection: DatabaseConnection,
    onSuccess?: () => void,
    onError?: (error: string) => void
  ): Promise<boolean> => {
    try {
      const connectResponse = await fetch("/api/database/connect-and-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connection),
      });

      if (connectResponse.ok) {
        setSelectedConnection(connection);
        onSuccess?.();
        return true;
      } else {
        const errorData = await connectResponse
          .json()
          .catch(() => ({ error: "Connection failed" }));
        const errorMsg = `Failed to connect: ${errorData.error}`;
        console.error(errorMsg);
        onError?.(errorMsg);
        return false;
      }
    } catch (error: unknown) {
      const errorMsg = `Connection error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error(errorMsg);
      onError?.(errorMsg);
      return false;
    }
  };

  const autoConnectDefault = useCallback(async () => {
    try {
      setIsAutoConnecting(true);

      const defaultConnection = ConnectionManager.getDefaultConnection();
      if (!defaultConnection) {
        return;
      }

      await connectToDatabase(
        defaultConnection,
        () => {
          // On successful connection, fetch schema
          fetchFullSchema(defaultConnection.id, () => {});
        },
        (error) => {
          console.error("Auto-connect failed:", error);
        }
      );
    } catch (error) {
      console.error("Error during auto-connect:", error);
    } finally {
      setIsAutoConnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectionSelect = async (
    connection: DatabaseConnection
  ): Promise<void> => {
    setSelectedTable(null);
    setAvailableTables([]);
    setQueryResult(null);

    return new Promise((resolve, reject) => {
      connectToDatabase(
        connection,
        () => {
          // On successful connection, fetch schema
          fetchFullSchema(
            connection.id,
            () => {
              resolve();
            },
            (error) => {
              console.error("Schema loading failed:", error);
              reject(new Error(error));
            }
          );
        },
        (error) => {
          console.error("Manual connection failed:", error);
          reject(new Error(error));
        }
      );
    });
  };

  const handleTableSelect = (schema: string, table: string) => {
    setSelectedTable({ schema, table });
    setCurrentSchema(schema);
    // Clear query results to show default table view
    setQueryResult(null);
  };

  const fetchFullSchema = async (
    connectionId: string,
    onSuccess?: (
      schemas: { schema_name: string; tables: DatabaseTable[] }[]
    ) => void,
    onError?: (error: string) => void,
    forceRefresh: boolean = false,
    retryCount: number = 0
  ) => {
    if (!connectionId) {
      const error = "Cannot fetch schema: no connection ID provided";
      console.error(error);
      onError?.(error);
      return;
    }

    const maxRetries = 3;

    // Check cache first (unless force refresh)
    if (!forceRefresh && retryCount === 0) {
      const cached = getCachedSchema(connectionId);
      if (cached) {
        console.log(`📋 Using cached schema for ${connectionId}`);

        // Update state with cached data
        setFullSchema(cached.schemas);
        setAvailableTables(cached.tables);

        // Update current schema if needed
        if (
          !cached.schemas.find((s) => s.schema_name === currentSchema) &&
          cached.schemas.length > 0
        ) {
          setCurrentSchema(cached.schemas[0].schema_name);
        }

        onSuccess?.(cached.schemas);
        return;
      }
    }

    if (retryCount === 0) {
      setIsLoadingSchema(true);
    }

    try {
      console.log(
        `🔄 Fetching schema for ${connectionId} (attempt ${retryCount + 1})`
      );

      const res = await fetch(
        `/api/database/full-schema?connectionId=${encodeURIComponent(
          connectionId
        )}`
      );

      if (!res.ok) {
        const errorData = await res
          .json()
          .catch(() => ({ error: "Unknown error" }));
        const error = `Failed to fetch schema (${res.status}): ${errorData.error}`;
        throw new Error(error);
      }

      const { schemas } = await res.json();

      // Flatten all schemas' tables so AI gets complete context
      const allTables: DatabaseTable[] = schemas.flatMap(
        (s: { schema_name: string; tables: DatabaseTable[] }) =>
          (s.tables || []).map((t) => ({ ...t, table_schema: s.schema_name }))
      );

      // Update state
      setFullSchema(schemas);
      setAvailableTables(allTables);

      // Save to cache
      saveSchemaCache(connectionId, schemas, allTables);

      // If no current schema among received, pick first for UI defaults
      if (
        !schemas.find(
          (s: { schema_name: string }) => s.schema_name === currentSchema
        ) &&
        schemas.length > 0
      ) {
        setCurrentSchema(schemas[0].schema_name);
      }

      console.log(`✅ Schema loaded successfully for ${connectionId}`);
      // Call success callback
      onSuccess?.(schemas);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      console.error(
        `Schema loading error (attempt ${retryCount + 1}):`,
        errorMessage
      );

      // Retry with exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, retryCount), 10000);
        setTimeout(() => {
          fetchFullSchema(
            connectionId,
            onSuccess,
            onError,
            forceRefresh,
            retryCount + 1
          );
        }, delay);
      } else {
        // After all retries failed, call error callback
        const finalError = `Error fetching full schema: ${errorMessage} (after ${
          maxRetries + 1
        } attempts)`;
        onError?.(finalError);
      }
    } finally {
      if (retryCount === 0) {
        setIsLoadingSchema(false);
      }
    }
  };

  const handleQueryExecute = async (query: string): Promise<QueryResult> => {
    if (!selectedConnection) {
      throw new Error("No database connection selected");
    }

    const response = await fetch("/api/database/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: selectedConnection.id,
        query,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw {
        message: errorData.error || "Query execution failed",
        code: "QUERY_ERROR",
      };
    }

    const { result } = await response.json();
    setQueryResult(result);

    // Auto-save successful query to history (fire and forget)
    saveQueryToHistory(query, result).catch((err) => {
      console.error("Failed to save query to history:", err);
    });

    return result;
  };

  // Helper function to save query to history
  const saveQueryToHistory = async (query: string, result: QueryResult) => {
    try {
      // Only save SELECT queries (not mutations)
      const normalizedQuery = query.trim().toUpperCase();
      if (!normalizedQuery.startsWith("SELECT")) {
        return; // Don't save INSERT, UPDATE, DELETE, etc.
      }

      // Extract table name from query
      const tableName = QueryHistoryManager.extractTableName(query);
      const schemaName = selectedTable?.schema || currentSchema;

      // Save to history with a placeholder title (will be updated by AI)
      const savedEntry = QueryHistoryManager.saveQuery({
        connectionId: selectedConnection!.id,
        tableName,
        schemaName,
        sql: query,
        title: "Generating title...", // Placeholder
      });

      // Immediately try to generate AI title (still async but prioritized)
      tryGenerateAITitle(savedEntry.id, query);
    } catch (error) {
      console.error("Error saving query to history:", error);
    }
  };

  // Helper function to generate AI title in the background
  const tryGenerateAITitle = async (queryId: string, sql: string) => {
    try {
      // Get API key from storage
      const GEMINI_API_KEY_STORAGE = "gemini-api-key";
      let storedApiKey = null;

      if (typeof window !== "undefined" && window.localStorage) {
        storedApiKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
      }

      if (!storedApiKey) {
        storedApiKey = secureStorage.get<string>(GEMINI_API_KEY_STORAGE);
      }

      if (!storedApiKey) {
        // No API key, use simple title generation as fallback
        const simpleTitle = QueryHistoryManager.generateSimpleTitle(sql);
        QueryHistoryManager.updateQueryTitle(queryId, simpleTitle);
        return;
      }

      // Call the API to generate a title using Gemini 2.0 Flash
      const response = await fetch("/api/ai/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, apiKey: storedApiKey }),
      });

      if (response.ok) {
        const { title, description } = await response.json();
        if (title) {
          QueryHistoryManager.updateQueryTitle(queryId, title, description);
        }
      } else {
        // AI failed, use simple title
        const simpleTitle = QueryHistoryManager.generateSimpleTitle(sql);
        QueryHistoryManager.updateQueryTitle(queryId, simpleTitle);
      }
    } catch (error) {
      // On error, use simple title generation as fallback
      console.debug("AI title generation failed, using simple title:", error);
      const simpleTitle = QueryHistoryManager.generateSimpleTitle(sql);
      QueryHistoryManager.updateQueryTitle(queryId, simpleTitle);
    }
  };

  // AI query handler (currently unused but kept for future use)
  // const handleAIQuery = async (naturalLanguage: string): Promise<string> => {
  //     if (!selectedConnection) {
  //         throw new Error("No database connection selected");
  //     }

  //     if (!naturalLanguage.trim()) {
  //         throw new Error("Please enter a natural language query");
  //     }

  //     try {
  //         const response = await fetch("/api/ai/query", {
  //             method: "POST",
  //             headers: { "Content-Type": "application/json" },
  //             body: JSON.stringify({
  //                 naturalLanguage: naturalLanguage.trim(),
  //                 context: {
  //                     tables: availableTables,
  //                     currentSchema,
  //                 },
  //             }),
  //         });

  //         if (!response.ok) {
  //             const errorData = await response.json();
  //             throw new Error(errorData.error || "Failed to generate SQL");
  //         }

  //         const { response: aiResponse } = await response.json();

  //         if (aiResponse?.sql) {
  //             return aiResponse.sql;
  //         } else {
  //             throw new Error("AI did not generate valid SQL");
  //         }
  //     } catch (error: unknown) {
  //         console.error("AI query generation failed:", error);
  //         throw new Error(error instanceof Error ? error.message : "Failed to generate SQL query");
  //     }
  // };

  // SQL generation handler (currently unused but kept for future use)
  // const handleSQLGenerated = (sql: string) => {
  //     // SQL generated, will be handled in the enhanced AI assistant
  // };

  // DataViewer handlers
  const openDataViewer = (
    data: unknown,
    columnName: string,
    dataType: string,
    tableName?: string,
    column?: DatabaseColumn,
    rowIndex: number = -1
  ) => {
    setDataViewer({
      isVisible: true,
      data,
      dataType,
      columnName,
      tableName,
      column,
      rowIndex,
    });
  };

  const handleDataViewerSave = async (newValue: unknown) => {
    if (!selectedConnection || !selectedTable || dataViewer.rowIndex === -1) {
      throw new Error(
        "Cannot save: missing connection, table, or row information"
      );
    }

    try {
      // Get the current table data to find the row
      const tableData = await fetch(`/api/database/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedConnection.id,
          query: `SELECT * FROM "${selectedTable.schema}"."${selectedTable.table}" LIMIT 100`,
        }),
      });

      if (!tableData.ok) {
        throw new Error("Failed to fetch current table data");
      }

      const { result } = await tableData.json();
      const row = result.rows[dataViewer.rowIndex];

      // Find primary key for the row
      const table = availableTables.find(
        (t) => t.table_name === selectedTable.table
      );
      const primaryKeyColumn = table?.columns.find((col) => col.is_primary_key);

      if (!primaryKeyColumn) {
        throw new Error("Cannot update row: no primary key found");
      }

      const primaryKey = {
        column: primaryKeyColumn.column_name,
        value: row[primaryKeyColumn.column_name],
      };

      // Update the row
      const response = await fetch("/api/database/update-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedConnection.id,
          schema: selectedTable.schema,
          tableName: selectedTable.table,
          primaryKey,
          updates: { [dataViewer.columnName]: newValue },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update row");
      }

      console.log("DataViewer save successful");
    } catch (error) {
      console.error("DataViewer save error:", error);
      throw error;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="h-14 header-border bg-white flex items-center px-6">
        <div className="flex items-center">
          <div className="h-7 w-7 bg-black rounded-md flex items-center justify-center mr-3">
            <span className="text-white font-semibold text-xs">DB</span>
          </div>
          <h1 className="text-lg font-semibold text-black">DB Manager</h1>
          <span className="ml-3 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-md font-medium">
            AI-Powered
          </span>
        </div>

        {selectedConnection && (
          <div className="ml-8 text-sm text-gray-600 flex items-center">
            <span className="text-gray-400">Connected to</span>{" "}
            <span className="font-medium text-black ml-1">
              {selectedConnection.name}
            </span>
            {isLoadingSchema ? (
              <div className="ml-2 flex items-center">
                <RefreshCw className="h-3 w-3 animate-spin text-gray-400" />
                <span className="ml-1 text-xs text-gray-400">
                  Loading schema...
                </span>
              </div>
            ) : (
              <button
                onClick={() =>
                  selectedConnection &&
                  fetchFullSchema(
                    selectedConnection.id,
                    undefined,
                    undefined,
                    true
                  )
                }
                className="ml-2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                title="Refresh schema">
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center space-x-3">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="btn-ghost flex items-center">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </button>

          {selectedConnection && (
            <button
              onClick={() => setIsNavigatorOpen(!isNavigatorOpen)}
              className="lg:hidden btn-ghost">
              {isNavigatorOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {selectedConnection ? (
          <div className="flex h-full w-full">
            {/* Database Navigator - Resizable */}
            <ResizablePanel
              defaultWidth={288}
              minWidth={200}
              maxWidth={500}
              storageKey="db-navigator-width"
              className={`${
                isNavigatorOpen ? "translate-x-0" : "-translate-x-full"
              } lg:translate-x-0 transition-transform duration-300 ease-in-out
                                h-full bg-white z-10 fixed lg:relative lg:flex flex-col
                                ${
                                  isNavigatorOpen
                                    ? "shadow-xl lg:shadow-none"
                                    : ""
                                }`}>
              <DatabaseNavigator
                connection={selectedConnection}
                onTableSelect={handleTableSelect}
                selectedTable={selectedTable || undefined}
              />
            </ResizablePanel>

            {/* Overlay for mobile */}
            {isNavigatorOpen && (
              <div
                className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-5"
                onClick={() => setIsNavigatorOpen(false)}
              />
            )}

            {/* Table Viewer - Takes remaining space */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedTable || queryResult ? (
                <TableViewer
                  connectionId={selectedConnection.id}
                  schema={selectedTable?.schema || ""}
                  tableName={selectedTable?.table || ""}
                  table={
                    selectedTable
                      ? availableTables.find(
                          (t) => t.table_name === selectedTable.table
                        )
                      : undefined
                  }
                  queryResult={queryResult}
                  onDataViewerOpen={openDataViewer}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="h-12 w-12 mx-auto mb-4 text-gray-300">
                      <svg fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V8z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <p className="text-sm">
                      Select a table from the navigator or use AI Assistant to
                      query data
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* AI SQL Assistant + DataViewer - Resizable */}
            <ResizablePanel
              defaultWidth={320}
              minWidth={280}
              maxWidth={600}
              storageKey="ai-assistant-width"
              className="bg-gray-50 flex flex-col"
              position="left">
              {/* AI Assistant - Takes available space when no data viewer */}
              <div
                className={`${
                  dataViewer.isVisible ? "flex-1" : "h-full"
                } min-h-0`}>
                <EnhancedAIAssistant
                  connectionId={selectedConnection.id}
                  tables={availableTables}
                  currentSchema={currentSchema}
                  onQueryExecute={handleQueryExecute}
                  fullSchema={fullSchema}
                  selectedTable={selectedTable}
                />
              </div>

              {/* DataViewer Panel - Larger height when visible */}
              {dataViewer.isVisible && (
                <div className="h-96 flex-shrink-0">
                  <DataViewer
                    isVisible={dataViewer.isVisible}
                    data={dataViewer.data}
                    dataType={dataViewer.dataType}
                    columnName={dataViewer.columnName}
                    tableName={dataViewer.tableName}
                    isEditable={!!selectedConnection}
                    column={dataViewer.column}
                    onSave={handleDataViewerSave}
                    rowIndex={dataViewer.rowIndex}
                  />
                </div>
              )}
            </ResizablePanel>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center max-w-md mx-auto px-6">
              <div className="h-20 w-20 mx-auto mb-6 bg-gray-100 rounded-2xl flex items-center justify-center">
                <svg
                  className="h-10 w-10 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                  />
                </svg>
              </div>

              {isAutoConnecting ? (
                <>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                    Connecting to Database...
                  </h2>
                  <div className="flex justify-center mb-6">
                    <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                </>
              ) : !ConnectionManager.hasAnyConnection() ? (
                <>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                    Welcome to DB Manager
                  </h2>
                  <p className="text-gray-600 mb-8 leading-relaxed">
                    Configure your first PostgreSQL connection to get started
                    with AI-powered database management
                  </p>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="btn-primary">
                    Add Database Connection
                  </button>
                </>
              ) : ConnectionManager.hasMultipleConnections() &&
                !ConnectionManager.getDefaultConnection() ? (
                <>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                    Multiple Connections Available
                  </h2>
                  <p className="text-gray-600 mb-8 leading-relaxed">
                    Please select a connection from Settings or set a default
                    connection
                  </p>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="btn-primary">
                    Choose Connection
                  </button>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                    Welcome to DB Manager
                  </h2>
                  <p className="text-gray-600 mb-8 leading-relaxed">
                    Connect to your PostgreSQL database to get started
                  </p>
                </>
              )}

              {!isAutoConnecting && (
                <div className="mt-12 space-y-3">
                  <div className="flex items-center text-sm text-gray-500">
                    <div className="w-1.5 h-1.5 bg-gray-300 rounded-full mr-3"></div>
                    <span>Browse database schemas and tables</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <div className="w-1.5 h-1.5 bg-gray-300 rounded-full mr-3"></div>
                    <span>Execute SQL queries with syntax highlighting</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <div className="w-1.5 h-1.5 bg-gray-300 rounded-full mr-3"></div>
                    <span>Use AI to convert natural language to SQL</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <div className="w-1.5 h-1.5 bg-gray-300 rounded-full mr-3"></div>
                    <span>View and export table data</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onConnectionSelect={handleConnectionSelect}
        currentConnectionId={selectedConnection?.id}
        onConnectionTest={(connection) => connectToDatabase(connection)}
      />
    </div>
  );
}
