"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DatabaseConnection, DatabaseTable } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronDown,
  Database,
  Table,
  Columns3,
  Key,
  Link,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface DatabaseNavigatorProps {
  connection: DatabaseConnection | null;
  onTableSelect: (schema: string, table: string) => void;
  selectedTable?: { schema: string; table: string };
}

interface SchemaNode {
  name: string;
  expanded: boolean;
  tables: DatabaseTable[];
  loading: boolean;
}

export default function DatabaseNavigator({
  connection,
  onTableSelect,
  selectedTable,
}: DatabaseNavigatorProps) {
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);



  const loadSchemas = useCallback(async () => {
    if (!connection) return;

    setLoading(true);
    setError(null);

    try {
      // Don't create connection here - assume it's already connected by parent
      // Just fetch schemas directly
      const schemasResponse = await fetch(
        `/api/database/schemas?connectionId=${connection.id}`
      );

      if (!schemasResponse.ok) {
        const errorData = await schemasResponse.json();
        throw new Error(errorData.error || "Failed to fetch schemas");
      }

      const { schemas: schemaNames } = await schemasResponse.json();

      const schemaNodes: SchemaNode[] = schemaNames.map((name: string) => ({
        name,
        expanded: false,
        tables: [],
        loading: false,
      }));

      setSchemas(schemaNodes);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load database schemas";
      setError(errorMessage);
      console.error("Schema loading error:", err);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    if (connection) {
      loadSchemas();
    } else {
      setSchemas([]);
      setError(null);
    }
  }, [connection, loadSchemas]);

  const toggleSchema = async (schemaName: string) => {
    if (!connection) return;

    setSchemas((prev) =>
      prev.map((schema) => {
        if (schema.name === schemaName) {
          if (!schema.expanded && schema.tables.length === 0) {
            // Load tables for this schema
            loadTables(schemaName);
          }
          return { ...schema, expanded: !schema.expanded };
        }
        return schema;
      })
    );
  };

  const loadTables = async (schemaName: string) => {
    if (!connection) return;

    setSchemas((prev) =>
      prev.map((schema) =>
        schema.name === schemaName ? { ...schema, loading: true } : schema
      )
    );

    try {
      // Fetch tables directly - assume connection is already established by parent
      const response = await fetch(
        `/api/database/tables?connectionId=${connection.id}&schema=${schemaName}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `Failed to fetch tables for schema ${schemaName}`
        );
      }

      const { tables } = await response.json();

      setSchemas((prev) =>
        prev.map((schema) =>
          schema.name === schemaName
            ? { ...schema, tables, loading: false }
            : schema
        )
      );
    } catch (err: unknown) {
      console.error(`Error loading tables for schema ${schemaName}:`, err);
      setSchemas((prev) =>
        prev.map((schema) =>
          schema.name === schemaName ? { ...schema, loading: false } : schema
        )
      );
    }
  };

  const refreshSchemas = () => {
    loadSchemas();
  };

  if (!connection) {
    return (
      <div className="p-4 text-center text-black">
        <Database className="mx-auto h-12 w-12 text-gray-600 mb-2" />
        <p className="text-sm">Select a connection to browse the database</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white min-w-[280px]">
      {/* Header - Fixed */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center">
            <Database className="mr-2 h-5 w-5" />
            Navigator
          </h2>
          <Button
            onClick={refreshSchemas}
            size="sm"
            variant="outline"
            disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="text-sm text-black mb-3 p-2 bg-white border border-black rounded">
          <div className="font-medium truncate" title={connection.name}>
            {connection.name}
          </div>
          <div
            className="text-xs text-gray-600 truncate"
            title={`${connection.host}:${connection.port}/${connection.database}`}>
            {connection.host}:{connection.port}/{connection.database}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-white border border-black rounded text-sm text-black">
            {error}
          </div>
        )}
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-black" />
              <span className="ml-2 text-sm text-black">
                Loading schemas...
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {schemas.map((schema) => (
                <div key={schema.name}>
                  {/* Schema Header */}
                  <div
                    className="flex items-center p-2 hover:bg-gray-100 cursor-pointer rounded"
                    onClick={() => toggleSchema(schema.name)}>
                    {schema.expanded ? (
                      <ChevronDown className="h-4 w-4 mr-1 text-black flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 mr-1 text-black flex-shrink-0" />
                    )}
                    <Database className="h-4 w-4 mr-2 text-black flex-shrink-0" />
                    <span
                      className="text-sm font-medium truncate"
                      title={schema.name}>
                      {schema.name}
                    </span>
                    {schema.loading && (
                      <Loader2 className="h-3 w-3 animate-spin ml-auto text-black flex-shrink-0" />
                    )}
                  </div>

                  {/* Tables */}
                  {schema.expanded && (
                    <div className="ml-6 space-y-1">
                      {schema.tables.map((table) => {
                        const isSelected =
                          selectedTable?.schema === schema.name &&
                          selectedTable?.table === table.table_name;

                        return (
                          <div key={`${schema.name}.${table.table_name}`}>
                            {/* Table Header */}
                            <div
                              className={`flex items-center p-2 hover:bg-gray-100 cursor-pointer rounded text-sm ${isSelected
                                ? "bg-gray-200 text-black border-black border"
                                : ""
                                }`}
                              onClick={() =>
                                onTableSelect(schema.name, table.table_name)
                              }>
                              <Table className="h-4 w-4 mr-2 text-black flex-shrink-0" />
                              <span
                                className="flex-1 truncate"
                                title={table.table_name}>
                                {table.table_name}
                              </span>
                              {table.row_count !== undefined && (
                                <span className="text-xs text-gray-600 flex-shrink-0 ml-2">
                                  ({table.row_count} rows)
                                </span>
                              )}
                            </div>

                            {/* Table Columns (when selected) - Scrollable */}
                            {isSelected && (
                              <div className="ml-6 max-h-60 overflow-y-auto border-l border-gray-400 pl-2">
                                <div className="space-y-1">
                                  {table.columns.map((column) => (
                                    <div
                                      key={column.column_name}
                                      className="flex items-center p-1 text-xs text-black">
                                      {column.is_primary_key ? (
                                        <Key className="h-3 w-3 mr-2 text-black flex-shrink-0" />
                                      ) : column.is_foreign_key ? (
                                        <Link className="h-3 w-3 mr-2 text-black flex-shrink-0" />
                                      ) : (
                                        <Columns3 className="h-3 w-3 mr-2 text-gray-600 flex-shrink-0" />
                                      )}
                                      <span
                                        className="flex-1 truncate"
                                        title={column.column_name}>
                                        {column.column_name}
                                      </span>
                                      <span
                                        className="text-xs text-gray-600 flex-shrink-0 ml-2"
                                        title={column.data_type}>
                                        {column.data_type}
                                        {!column.is_nullable && (
                                          <span className="ml-1 text-black">
                                            *
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {schema.tables.length === 0 && !schema.loading && (
                        <div className="ml-6 text-xs text-gray-600 p-2">
                          No tables found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {schemas.length === 0 && !loading && !error && (
                <div className="text-center py-8 text-gray-500">
                  <Database className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm">No schemas found</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
