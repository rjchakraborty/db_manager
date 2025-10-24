"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { DatabaseTable, QueryResult, DatabaseColumn } from "@/types/database";
import { formatNumber, copyToClipboard, downloadAsFile } from "@/lib/utils";
import {
  Table,
  Eye,
  Download,
  Copy,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Key,
  Link,
  X,
  Trash2,
  FileJson,
} from "lucide-react";

interface TableViewerProps {
  connectionId?: string;
  schema: string;
  tableName: string;
  table?: DatabaseTable;
  queryResult?: QueryResult | null;
  onDataViewerOpen?: (data: unknown, columnName: string, dataType: string, tableName?: string, column?: DatabaseColumn, rowIndex?: number) => void;
}

export default function TableViewer({
  connectionId,
  schema,
  tableName,
  table,
  queryResult,
  onDataViewerOpen,
}: TableViewerProps) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);

  // Editing states (simplified - most editing now handled by DataViewer)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dependencies, setDependencies] = useState<Array<{ table: string; column: string }>>([]);
  const [checkingDependencies, setCheckingDependencies] = useState(false);


  const rowsPerPage = 100;

  // Helper function to open data viewer
  const handleCellClick = (data: unknown, columnName: string, column?: DatabaseColumn, rowIdx: number = -1) => {
    if (onDataViewerOpen) {
      onDataViewerOpen(
        data,
        columnName,
        column?.data_type || "text",
        `${schema}.${tableName}`,
        column,
        rowIdx
      );
    }
  };




  const loadTableData = useCallback(async (retryCount = 0) => {
    if (!connectionId) return;

    const maxRetries = 3;

    if (retryCount === 0) {
      setLoading(true);
      setError(null);
    }

    try {
      const offset = (currentPage - 1) * rowsPerPage;
      const query = `SELECT * FROM "${schema}"."${tableName}" LIMIT ${rowsPerPage} OFFSET ${offset}`;

      const response = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, query }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || "Failed to fetch table data");
      }

      const { result } = await response.json();
      setData(result);

      // Clear any previous errors on success
      if (error) {
        setError(null);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load table data";
      console.error(`Table data loading error (attempt ${retryCount + 1}):`, err);

      // Retry with exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        setTimeout(() => {
          loadTableData(retryCount + 1);
        }, delay);
      } else {
        // After all retries failed, show error
        setError(`${errorMessage} (after ${maxRetries + 1} attempts)`);
      }
    } finally {
      if (retryCount === 0) {
        setLoading(false);
      }
    }
  }, [connectionId, schema, tableName, currentPage, error]);

  const loadRowCount = useCallback(async (retryCount = 0) => {
    if (!connectionId) return;

    const maxRetries = 3;

    try {
      const query = `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`;

      const response = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, query }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || "Failed to fetch row count");
      }

      const { result } = await response.json();
      setTotalRows(parseInt(result.rows[0].count) || 0);
    } catch (err: unknown) {
      console.error(`Row count loading error (attempt ${retryCount + 1}):`, err);

      // Retry with exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        setTimeout(() => {
          loadRowCount(retryCount + 1);
        }, delay);
      } else {
        // After all retries failed, set a default count
        console.warn(`Failed to load row count after ${maxRetries + 1} attempts, using fallback`);
        setTotalRows(0);
      }
    }
  }, [connectionId, schema, tableName]);


  useEffect(() => {
    if (queryResult) {
      // Use query result data
      setData(queryResult);
      setTotalRows(queryResult.rowCount);
      setError(null);
    } else if (connectionId && schema && tableName) {
      // Load table data
      loadTableData();
      loadRowCount();
    }
  }, [connectionId, schema, tableName, currentPage, queryResult, loadTableData, loadRowCount]);

  const handleRefresh = () => {
    loadTableData();
    loadRowCount();
    // Clear editing states on refresh
    setConfirmDelete(null);
    setDependencies([]);
  };

  // Helper functions for editing
  const getPrimaryKeyColumns = (): DatabaseColumn[] => {
    return table?.columns.filter(col => col.is_primary_key) || [];
  };

  const getPrimaryKeyValue = (row: Record<string, unknown>): Record<string, unknown> => {
    const pkColumns = getPrimaryKeyColumns();
    const pkValue: Record<string, unknown> = {};
    pkColumns.forEach(col => {
      pkValue[col.column_name] = row[col.column_name];
    });
    return pkValue;
  };

  // Column editing helper (currently unused but kept for future use)
  // const isColumnEditable = (columnName: string): boolean => {
  //   const column = table?.columns.find(col => col.column_name === columnName);
  //   return column ? !column.is_primary_key : true;
  // };

  // Validation function (currently unused but kept for future use)
  // const validateValue = (value: string, column: DatabaseColumn): string | null => {
  //   // Basic validation
  //   if (!column.is_nullable && (value === "" || value === null)) {
  //     return "This field cannot be null";
  //   }

  //   // Type-specific validation
  //   if (column.data_type.includes('integer') || column.data_type.includes('bigint')) {
  //     if (value !== "" && isNaN(Number(value))) {
  //       return "Must be a valid number";
  //     }
  //   }

  //   if (column.data_type.includes('numeric') || column.data_type.includes('decimal')) {
  //     if (value !== "" && isNaN(Number(value))) {
  //       return "Must be a valid decimal number";
  //     }
  //   }

  //   if (column.character_maximum_length && value.length > column.character_maximum_length) {
  //     return `Maximum length is ${column.character_maximum_length} characters`;
  //   }

  //   return null;
  // };


  const checkDependencies = async (rowIndex: number) => {
    if (!connectionId || !data || !table) return;

    setCheckingDependencies(true);
    try {
      const row = data.rows[rowIndex];
      const primaryKey = getPrimaryKeyValue(row);

      const response = await fetch("/api/database/check-dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          schema,
          tableName,
          primaryKey
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to check dependencies");
      }

      const result = await response.json();
      setDependencies(result.dependencies || []);
      setConfirmDelete(rowIndex);

    } catch (error: unknown) {
      console.error("Dependency check error:", error);
      // Still allow deletion attempt, but without dependency info
      setDependencies([]);
      setConfirmDelete(rowIndex);
    } finally {
      setCheckingDependencies(false);
    }
  };

  const copyRowAsJSON = (rowIndex: number) => {
    if (!data || !table) return;

    try {
      const row = data.rows[rowIndex];
      const jsonData: Record<string, unknown> = {};

      // Process each field with proper type conversion
      data.fields.forEach(field => {
        const column = table.columns.find(col => col.column_name === field.name);
        const value = row[field.name];

        if (value === null || value === undefined) {
          jsonData[field.name] = null;
        } else if (column) {
          // Convert based on database column type
          if (column.data_type.includes('json') || column.data_type.includes('jsonb')) {
            // Already JSON, parse if it's a string
            jsonData[field.name] = typeof value === 'string' ? JSON.parse(value) : value;
          } else if (column.data_type.includes('boolean')) {
            jsonData[field.name] = Boolean(value);
          } else if (column.data_type.includes('integer') || column.data_type.includes('bigint') || column.data_type.includes('smallint')) {
            jsonData[field.name] = parseInt(String(value));
          } else if (column.data_type.includes('numeric') || column.data_type.includes('decimal') || column.data_type.includes('real') || column.data_type.includes('double')) {
            jsonData[field.name] = parseFloat(String(value));
          } else if (column.data_type.includes('timestamp') || column.data_type.includes('date') || column.data_type.includes('time')) {
            jsonData[field.name] = new Date(String(value)).toISOString();
          } else {
            // Default to string for text, varchar, etc.
            jsonData[field.name] = String(value);
          }
        } else {
          // Fallback if no column info
          jsonData[field.name] = value;
        }
      });

      // Format JSON with proper indentation
      const formattedJSON = JSON.stringify(jsonData, null, 2);

      // Copy to clipboard
      copyToClipboard(formattedJSON);

      // Show success feedback (you could replace this with a toast notification)
      console.log('Row copied as JSON:', formattedJSON);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to copy row as JSON";
      console.error("JSON copy error:", error);
      alert(`Failed to copy row as JSON: ${errorMessage}`);
    }
  };

  const deleteRow = async (rowIndex: number) => {
    if (!connectionId || !data || !table) {
      return;
    }

    setUpdating(true);
    try {
      const row = data.rows[rowIndex];
      const primaryKey = getPrimaryKeyValue(row);

      const response = await fetch("/api/database/delete-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          schema,
          tableName,
          primaryKey
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Handle foreign key constraint violations with better UI
        if (errorData.errorType === 'FOREIGN_KEY_VIOLATION') {
          const message = `${errorData.error}\n\n${errorData.suggestion}`;
          alert(message);
        } else {
          throw new Error(errorData.error || "Failed to delete row");
        }
        return;
      }

      // Remove row from display and refresh
      handleRefresh();
      setConfirmDelete(null);
      setDependencies([]);

      const result = await response.json();
      console.log('Delete successful:', result.message);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to delete row";
      console.error("Delete error:", error);
      alert(`Failed to delete row: ${errorMessage}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleCopyData = () => {
    if (data) {
      const csvContent = [
        data.fields.map((f) => f.name).join(","),
        ...data.rows.map((row) =>
          data.fields
            .map((f) => {
              const value = row[f.name];
              return typeof value === "string" ? `"${value}"` : value;
            })
            .join(",")
        ),
      ].join("\n");
      copyToClipboard(csvContent);
    }
  };

  const handleDownloadData = () => {
    if (data) {
      const csvContent = [
        data.fields.map((f) => f.name).join(","),
        ...data.rows.map((row) =>
          data.fields
            .map((f) => {
              const value = row[f.name];
              return typeof value === "string" ? `"${value}"` : value;
            })
            .join(",")
        ),
      ].join("\n");

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-");
      downloadAsFile(
        csvContent,
        `${schema}_${tableName}_${timestamp}.csv`,
        "text/csv"
      );
    }
  };

  const totalPages = Math.ceil(totalRows / rowsPerPage);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Table className="h-5 w-5 mr-2 text-black" />
          <div>
            <h2 className="text-lg font-semibold">
              {queryResult ? "Query Results" : `${schema}.${tableName}`}
            </h2>
            <p className="text-sm text-gray-600">
              {formatNumber(totalRows)} {totalRows === 1 ? "row" : "rows"} total
              {data?.duration && ` • ${data.duration}ms`}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between w-full">
          {/* Left: Status & Action Area */}
          <div className="flex items-center space-x-3">
            {!queryResult && connectionId && (
              <>
                {/* Delete Mode */}
                {confirmDelete !== null && (
                  <>
                    <div className="flex items-center text-sm bg-red-50 border border-red-200 px-3 py-1.5 rounded">
                      <Trash2 className="h-4 w-4 mr-2 text-red-600" />
                      <span className="text-red-800 font-medium">
                        {dependencies.length > 0 ? (
                          <>⚠️ Referenced by {dependencies.length} table{dependencies.length !== 1 ? 's' : ''}</>
                        ) : (
                          <>Confirm deletion</>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Button
                        onClick={() => confirmDelete !== null && deleteRow(confirmDelete)}
                        disabled={updating}
                        size="sm"
                        className={`${dependencies.length > 0 ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'} text-white`}>
                        <Trash2 className="h-4 w-4 mr-1" />
                        {dependencies.length > 0 ? 'Force Delete' : 'Delete'}
                      </Button>

                      <Button
                        onClick={() => {
                          setConfirmDelete(null);
                          setDependencies([]);
                        }}
                        disabled={updating}
                        variant="outline"
                        size="sm">
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Right: Table Actions */}
          <div className="flex items-center space-x-2">
            <Button
              onClick={handleRefresh}
              variant="outline"
              size="sm"
              disabled={loading || confirmDelete !== null}>
              <RefreshCw
                className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>

            <Button
              onClick={handleCopyData}
              variant="outline"
              size="sm"
              disabled={!data || confirmDelete !== null}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>

            <Button
              onClick={handleDownloadData}
              variant="outline"
              size="sm"
              disabled={!data || confirmDelete !== null}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </div>


      {/* Data Content */}
      <div className="flex-1 flex flex-col">
        {error ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-black">
              <p className="mb-2">Error loading table data</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-black">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p>Loading table data...</p>
            </div>
          </div>
        ) : data ? (
          <>
            {/* Pagination Controls - Only for table data, not query results */}
            {!queryResult && (
              <div className="flex items-center justify-between p-3 border-b border-gray-200">
                <div className="text-sm text-black">
                  Showing {(currentPage - 1) * rowsPerPage + 1} to{" "}
                  {Math.min(currentPage * rowsPerPage, totalRows)} of{" "}
                  {formatNumber(totalRows)} rows
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={currentPage <= 1}
                    variant="outline"
                    size="sm">
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>

                  <span className="text-sm text-black">
                    Page {currentPage} of {totalPages}
                  </span>

                  <Button
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                    }
                    disabled={currentPage >= totalPages}
                    variant="outline"
                    size="sm">
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Data Table with Enhanced Scrolling */}
            <div className="flex-1 overflow-hidden relative">
              {/* Horizontal and Vertical Scroll Container */}
              <div className="absolute inset-0 overflow-auto">
                <div className="min-w-max">
                  <table className="w-full min-w-max table-auto">
                    <thead className="bg-white border-b-2 border-black sticky top-0 z-10">
                      <tr>
                        {data && data.fields.map((field) => (
                          <th
                            key={field.name}
                            className="px-4 py-3 text-left text-xs font-medium text-black tracking-wider border-b border-gray-400 whitespace-nowrap min-w-[120px] bg-white">
                            <div className="flex items-center">
                              {field.name}
                              {table && table.columns.find(col => col.column_name === field.name) && (
                                <div className="ml-2 flex space-x-1">
                                  {table.columns.find(col => col.column_name === field.name)?.is_primary_key && (
                                    <Key className="h-3 w-3 text-black" />
                                  )}
                                  {table.columns.find(col => col.column_name === field.name)?.is_foreign_key && (
                                    <Link className="h-3 w-3 text-black" />
                                  )}
                                </div>
                              )}
                            </div>
                          </th>
                        ))}
                        {/* Actions column for non-query results - moved to right and made sticky */}
                        {!queryResult && connectionId && (
                          <th className="px-4 py-3 text-center text-xs font-medium text-black tracking-wider border-b border-gray-400 whitespace-nowrap min-w-[100px] bg-white sticky right-0 border-l border-gray-300">
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {data && data.rows.map((row, rowIndex) => {
                        return (
                          <tr
                            key={rowIndex}
                            className={`
                              ${rowIndex % 2 === 0 ? "bg-white" : "bg-gray-50"}
                              ${confirmDelete === rowIndex ? "bg-red-100" : ""}
                            `}>

                            {data && data.fields.map((field) => {
                              const column = table?.columns.find(col => col.column_name === field.name);

                              return (
                                <td
                                  key={field.name}
                                  className={`px-4 py-3 text-sm border-b border-gray-200 min-w-[120px] max-w-[400px] cursor-pointer hover:bg-gray-100 ${column?.is_primary_key ? "bg-gray-50" : ""}`}
                                  onClick={() => {
                                    handleCellClick(
                                      row[field.name],
                                      field.name,
                                      column,
                                      rowIndex
                                    );
                                  }}
                                  title={String(row[field.name])}>

                                  <div className="truncate">
                                    {row[field.name] === null ? (
                                      <span className="text-gray-600 italic">
                                        NULL
                                      </span>
                                    ) : (
                                      String(row[field.name])
                                    )}
                                  </div>
                                </td>
                              );
                            })}

                            {/* Sticky actions column for non-query results */}
                            {!queryResult && connectionId && (
                              <td className="px-2 py-3 text-center border-b border-gray-200 min-w-[100px] sticky right-0 bg-inherit border-l border-gray-300">
                                <div className="flex items-center justify-center space-x-1">
                                  {/* Copy as JSON button */}
                                  <button
                                    onClick={() => copyRowAsJSON(rowIndex)}
                                    disabled={updating || confirmDelete !== null}
                                    className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Copy row as JSON">
                                    <FileJson className="h-4 w-4" />
                                  </button>

                                  {/* Delete button */}
                                  <button
                                    onClick={() => checkDependencies(rowIndex)}
                                    disabled={updating || confirmDelete !== null || checkingDependencies}
                                    className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={
                                      checkingDependencies
                                        ? "Checking dependencies..."
                                        : "Delete row"
                                    }>
                                    {checkingDependencies ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* No Data Message */}
                {data && data.rows.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white">
                    <div className="text-center text-black">
                      <Eye className="mx-auto h-12 w-12 text-gray-600 mb-2" />
                      <p>No data in this table</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-black">
              <Eye className="mx-auto h-12 w-12 text-gray-600 mb-2" />
              <p>Select a table to view its data</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
