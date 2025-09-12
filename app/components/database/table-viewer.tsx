"use client";

import React, { useState, useEffect, useRef } from "react";
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
  Edit3,
  Save,
  X,
  Trash2,
  AlertTriangle,
  FileJson,
} from "lucide-react";

interface TableViewerProps {
  connectionId?: string;
  schema: string;
  tableName: string;
  table?: DatabaseTable;
  queryResult?: QueryResult | null;
}

export default function TableViewer({
  connectionId,
  schema,
  tableName,
  table,
  queryResult,
}: TableViewerProps) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);

  // Editing states
  const [editingCell, setEditingCell] = useState<{ rowIndex: number, fieldName: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [pendingUpdates, setPendingUpdates] = useState<Map<number, Record<string, any>>>(new Map());
  const [deletingRows, setDeletingRows] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [checkingDependencies, setCheckingDependencies] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);
  const rowsPerPage = 100;

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
  }, [connectionId, schema, tableName, currentPage, queryResult]);

  const loadTableData = async () => {
    if (!connectionId) return;

    setLoading(true);
    setError(null);

    try {
      const offset = (currentPage - 1) * rowsPerPage;
      const query = `SELECT * FROM "${schema}"."${tableName}" LIMIT ${rowsPerPage} OFFSET ${offset}`;

      const response = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, query }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch table data");
      }

      const { result } = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || "Failed to load table data");
      console.error("Table data loading error:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadRowCount = async () => {
    if (!connectionId) return;

    try {
      const query = `SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`;

      const response = await fetch("/api/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, query }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch row count");
      }

      const { result } = await response.json();
      setTotalRows(parseInt(result.rows[0].count) || 0);
    } catch (err: any) {
      console.error("Row count loading error:", err);
      // Don't set error state for row count failures
    }
  };

  const handleRefresh = () => {
    loadTableData();
    loadRowCount();
    // Clear editing states on refresh
    setEditingCell(null);
    setPendingUpdates(new Map());
    setDeletingRows(new Set());
    setConfirmDelete(null);
    setDependencies([]);
  };

  // Helper functions for editing
  const getPrimaryKeyColumns = (): DatabaseColumn[] => {
    return table?.columns.filter(col => col.is_primary_key) || [];
  };

  const getPrimaryKeyValue = (row: any): Record<string, any> => {
    const pkColumns = getPrimaryKeyColumns();
    const pkValue: Record<string, any> = {};
    pkColumns.forEach(col => {
      pkValue[col.column_name] = row[col.column_name];
    });
    return pkValue;
  };

  const isColumnEditable = (columnName: string): boolean => {
    const column = table?.columns.find(col => col.column_name === columnName);
    return column ? !column.is_primary_key : true;
  };

  const validateValue = (value: string, column: DatabaseColumn): string | null => {
    // Basic validation
    if (!column.is_nullable && (value === "" || value === null)) {
      return "This field cannot be null";
    }

    // Type-specific validation
    if (column.data_type.includes('integer') || column.data_type.includes('bigint')) {
      if (value !== "" && isNaN(Number(value))) {
        return "Must be a valid number";
      }
    }

    if (column.data_type.includes('numeric') || column.data_type.includes('decimal')) {
      if (value !== "" && isNaN(Number(value))) {
        return "Must be a valid decimal number";
      }
    }

    if (column.character_maximum_length && value.length > column.character_maximum_length) {
      return `Maximum length is ${column.character_maximum_length} characters`;
    }

    return null;
  };

  const startEditing = (rowIndex: number, fieldName: string, currentValue: any) => {
    if (!isColumnEditable(fieldName)) return;

    setEditingCell({ rowIndex, fieldName });
    setEditingValue(currentValue === null ? "" : String(currentValue));

    // Focus the input after state update
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditingValue("");
  };

  const saveEdit = () => {
    if (!editingCell || !data) return;

    const { rowIndex, fieldName } = editingCell;
    const column = table?.columns.find(col => col.column_name === fieldName);

    if (column) {
      const validationError = validateValue(editingValue, column);
      if (validationError) {
        alert(validationError);
        return;
      }
    }

    // Convert empty string to null for nullable columns
    const finalValue = editingValue === "" && column?.is_nullable ? null : editingValue;

    // Update pending changes
    const currentUpdates = pendingUpdates.get(rowIndex) || {};
    const newUpdates = { ...currentUpdates, [fieldName]: finalValue };
    const updatedMap = new Map(pendingUpdates);
    updatedMap.set(rowIndex, newUpdates);
    setPendingUpdates(updatedMap);

    // Update the display data
    const newData = { ...data };
    newData.rows[rowIndex][fieldName] = finalValue;
    setData(newData);

    cancelEditing();
  };

  const discardChanges = (rowIndex: number) => {
    if (!data) return;

    // Reload original data for this row
    const updatedMap = new Map(pendingUpdates);
    updatedMap.delete(rowIndex);
    setPendingUpdates(updatedMap);

    // Refresh the table to get original data
    handleRefresh();
  };

  const commitUpdates = async (rowIndex: number) => {
    if (!connectionId || !data || !table) {
      return;
    }

    const updates = pendingUpdates.get(rowIndex);
    if (!updates || Object.keys(updates).length === 0) {
      return;
    }

    setUpdating(true);
    try {
      const row = data.rows[rowIndex];
      const primaryKey = getPrimaryKeyValue(row);

      const response = await fetch("/api/database/update-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          schema,
          tableName,
          primaryKey,
          updates
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update row");
      }

      // Remove from pending updates
      const updatedMap = new Map(pendingUpdates);
      updatedMap.delete(rowIndex);
      setPendingUpdates(updatedMap);

      // Show success message
      const result = await response.json();
      console.log('Update successful:', result.message);

    } catch (error: any) {
      console.error("Update error:", error);
      alert(`Failed to update row: ${error.message}`);
      // Revert changes on error
      discardChanges(rowIndex);
    } finally {
      setUpdating(false);
    }
  };

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

    } catch (error: any) {
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
      const jsonData: Record<string, any> = {};

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

    } catch (error: any) {
      console.error("JSON copy error:", error);
      alert(`Failed to copy row as JSON: ${error.message}`);
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

    } catch (error: any) {
      console.error("Delete error:", error);
      alert(`Failed to delete row: ${error.message}`);
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
                {/* Edit Mode */}
                {pendingUpdates.size > 0 && (
                  <>
                    <div className="flex items-center text-sm bg-yellow-50 border border-yellow-200 px-3 py-1.5 rounded">
                      <Edit3 className="h-4 w-4 mr-2 text-yellow-600" />
                      <span className="text-yellow-800 font-medium">
                        {pendingUpdates.size} unsaved change{pendingUpdates.size !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Button
                        onClick={() => {
                          const rowIndex = Array.from(pendingUpdates.keys())[0];
                          commitUpdates(rowIndex);
                        }}
                        disabled={updating}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white">
                        <Save className="h-4 w-4 mr-1" />
                        Save
                      </Button>

                      <Button
                        onClick={() => {
                          const rowIndex = Array.from(pendingUpdates.keys())[0];
                          discardChanges(rowIndex);
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

                {/* Delete Mode */}
                {confirmDelete !== null && pendingUpdates.size === 0 && (
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
                        onClick={() => deleteRow(confirmDelete)}
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
              disabled={loading || pendingUpdates.size > 0 || confirmDelete !== null}>
              <RefreshCw
                className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>

            <Button
              onClick={handleCopyData}
              variant="outline"
              size="sm"
              disabled={!data || pendingUpdates.size > 0 || confirmDelete !== null}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>

            <Button
              onClick={handleDownloadData}
              variant="outline"
              size="sm"
              disabled={!data || pendingUpdates.size > 0 || confirmDelete !== null}>
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
                        {data.fields.map((field, index) => (
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
                      {data.rows.map((row, rowIndex) => {
                        const hasPendingUpdates = pendingUpdates.has(rowIndex);
                        const isDeleting = deletingRows.has(rowIndex);

                        return (
                          <tr
                            key={rowIndex}
                            className={`
                              ${rowIndex % 2 === 0 ? "bg-white" : "bg-gray-50"}
                              ${hasPendingUpdates ? "bg-yellow-50 border-l-4 border-yellow-400" : ""}
                              ${isDeleting ? "bg-red-50 opacity-50" : ""}
                              ${confirmDelete === rowIndex ? "bg-red-100" : ""}
                            `}>

                            {data.fields.map((field) => {
                              const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.fieldName === field.name;
                              const isEditable = !queryResult && connectionId && isColumnEditable(field.name) && confirmDelete === null;
                              const column = table?.columns.find(col => col.column_name === field.name);

                              return (
                                <td
                                  key={field.name}
                                  className={`px-4 py-3 text-sm border-b border-gray-200 min-w-[120px] max-w-[400px] ${isEditable ? "cursor-pointer hover:bg-gray-100" : ""
                                    } ${column?.is_primary_key ? "bg-gray-50" : ""}`}
                                  onClick={() => !isEditing && isEditable && startEditing(rowIndex, field.name, row[field.name])}>

                                  {isEditing ? (
                                    <div className="flex items-center space-x-2">
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        value={editingValue}
                                        onChange={(e) => setEditingValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEdit();
                                          if (e.key === 'Escape') cancelEditing();
                                        }}
                                        className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-black"
                                        placeholder={column?.is_nullable ? "NULL" : ""}
                                      />
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          saveEdit();
                                        }}
                                        className="p-1 text-green-600 hover:text-green-800">
                                        <Save className="h-3 w-3" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelEditing();
                                        }}
                                        className="p-1 text-gray-600 hover:text-gray-800">
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-between group">
                                      <div
                                        className="truncate flex-1"
                                        title={String(row[field.name])}>
                                        {row[field.name] === null ? (
                                          <span className="text-gray-600 italic">
                                            NULL
                                          </span>
                                        ) : (
                                          String(row[field.name])
                                        )}
                                      </div>
                                      {isEditable && (
                                        <Edit3 className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0" />
                                      )}
                                    </div>
                                  )}
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
                                    disabled={updating || pendingUpdates.size > 0 || confirmDelete !== null}
                                    className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={
                                      pendingUpdates.size > 0
                                        ? "Save or cancel changes first"
                                        : "Copy row as JSON"
                                    }>
                                    <FileJson className="h-4 w-4" />
                                  </button>

                                  {/* Delete button */}
                                  <button
                                    onClick={() => checkDependencies(rowIndex)}
                                    disabled={updating || pendingUpdates.size > 0 || confirmDelete !== null || checkingDependencies}
                                    className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={
                                      pendingUpdates.size > 0
                                        ? "Save or cancel changes first"
                                        : checkingDependencies
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
                {data.rows.length === 0 && (
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
