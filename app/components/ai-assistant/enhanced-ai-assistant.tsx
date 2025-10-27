"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { DatabaseTable, QueryResult } from "@/types/database";
import { Editor } from "@monaco-editor/react";
import { secureStorage } from "@/lib/encryption";
import { FavoritesManager, FavoriteQuery } from "@/lib/favorites";
import { QueryHistoryManager, QueryHistoryEntry } from "@/lib/query-history";
import { Star, StarOff, RefreshCw, Save, Trash2, X } from "lucide-react";

interface EnhancedAIAssistantProps {
  connectionId?: string;
  tables: DatabaseTable[];
  currentSchema: string;
  onQueryExecute: (sql: string) => Promise<QueryResult>;
  fullSchema?: { schema_name: string; tables: DatabaseTable[] }[];
  selectedTable?: { schema: string; table: string } | null;
}

const GEMINI_API_KEY_STORAGE = "gemini-api-key";

export default function EnhancedAIAssistant({
  connectionId,
  tables,
  currentSchema,
  onQueryExecute,
  selectedTable,
}: EnhancedAIAssistantProps) {
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [sqlQuery, setSqlQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAIInput, setShowAIInput] = useState(true);
  const [showTableContext, setShowTableContext] = useState(false);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteQuery[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSaveFavorite, setShowSaveFavorite] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteDescription, setFavoriteDescription] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadFavorites = useCallback(() => {
    if (connectionId) {
      const connectionFavorites = FavoritesManager.getFavorites(connectionId);
      setFavorites(connectionFavorites);
    }
  }, [connectionId]);

  const loadQueryHistory = useCallback(() => {
    if (connectionId) {
      const tableName = selectedTable?.table;
      const history = QueryHistoryManager.getMostFrequentQueries(
        connectionId,
        tableName,
        10
      );
      setQueryHistory(history);
    }
  }, [connectionId, selectedTable]);

  // Load favorites and query history when component mounts or connection changes
  useEffect(() => {
    if (connectionId) {
      loadFavorites();
      loadQueryHistory();
    }
  }, [connectionId, loadFavorites, loadQueryHistory]);

  const handleDeleteHistory = (historyId: string) => {
    if (QueryHistoryManager.deleteQuery(historyId)) {
      loadQueryHistory(); // Refresh history list
      setDeleteConfirmId(null);
    }
  };

  const loadHistoryQuery = (history: QueryHistoryEntry) => {
    // Load the actual SQL query (not the title) into the SQL editor
    setSqlQuery(history.sql);
    setShowAIInput(false); // Switch to manual SQL editor mode
    setDeleteConfirmId(null);
  };

  const saveFavorite = () => {
    if (!connectionId || !sqlQuery.trim() || !favoriteName.trim()) return;

    try {
      FavoritesManager.saveFavorite({
        connectionId,
        name: favoriteName.trim(),
        sql: sqlQuery.trim(),
        description: favoriteDescription.trim(),
      });

      loadFavorites(); // Refresh favorites list
      setShowSaveFavorite(false);
      setFavoriteName("");
      setFavoriteDescription("");
    } catch (error) {
      console.error("Error saving favorite:", error);
      setError("Failed to save favorite query");
    }
  };

  const deleteFavorite = (favoriteId: string) => {
    if (FavoritesManager.deleteFavorite(favoriteId)) {
      loadFavorites(); // Refresh favorites list
    }
  };

  const loadFavoriteQuery = (favorite: FavoriteQuery) => {
    setSqlQuery(favorite.sql);
    setShowAIInput(false);
  };

  const buildTableContext = () => {
    return tables.map((table) => ({
      name: table.table_name,
      schema: table.table_schema || currentSchema,
      fullTableName: `${table.table_schema || currentSchema}."${
        table.table_name
      }"`,
      columns: table.columns.map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable,
        primaryKey: col.is_primary_key,
        foreignKey: col.is_foreign_key,
      })),
      rowCount: table.row_count,
      columnList: table.columns.map((col) => col.column_name).join(", "),
    }));
  };

  const handleGenerateSQL = async () => {
    if (!naturalLanguage.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      // Get API key from storage (try plain localStorage first for reliability)
      let storedApiKey = null;
      if (typeof window !== "undefined" && window.localStorage) {
        storedApiKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
      }

      // Fallback to encrypted storage
      if (!storedApiKey) {
        storedApiKey = secureStorage.get<string>(GEMINI_API_KEY_STORAGE);
      }

      if (!storedApiKey) {
        throw new Error("Please configure your Gemini API key in Settings");
      }

      const tableContext = buildTableContext();

      const response = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: storedApiKey || undefined,
          naturalLanguage: naturalLanguage.trim(),
          context: {
            tables: tableContext,
            currentSchema,
            connectionId, // allow server to validate against this connection
            availableTables: tables.map(
              (t) => `${t.table_schema || currentSchema}."${t.table_name}"`
            ),
            tableNames: tables.map((t) => t.table_name), // Add simple table names list
            selectedTable: selectedTable, // Pass the currently selected/opened table
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 400 && errorData.error?.includes("API key")) {
          throw new Error("Please configure your Gemini API key in Settings");
        }
        throw new Error(errorData.error || "Failed to generate SQL");
      }

      const { response: aiResponse, validationWarning } = await response.json();
      if (aiResponse?.sql) {
        setSqlQuery(aiResponse.sql);
        setShowAIInput(false);

        // Show validation warning if present
        if (validationWarning) {
          setError(`⚠️ ${validationWarning}`);
          // Clear the warning after 5 seconds
          setTimeout(() => setError(null), 5000);
        }
      } else {
        throw new Error("AI did not generate valid SQL");
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to generate SQL query";
      setError(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecuteSQL = async () => {
    if (!sqlQuery.trim()) return;

    setIsExecuting(true);
    setError(null);

    try {
      await onQueryExecute(sqlQuery);
      // Results will be displayed in the main TableViewer
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to execute query";
      setError(errorMessage);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleClear = () => {
    setSqlQuery("");
    setError(null);
    setNaturalLanguage("");
    setShowAIInput(true);
  };

  // Monaco SQL IntelliSense based on tables/columns
  const monacoCompletionProvider = useMemo(() => {
    const keywords = new Set<string>();
    tables.forEach((t) => {
      keywords.add(`"${t.table_name}"`);
      keywords.add(`${t.table_schema || currentSchema}."${t.table_name}"`);
      t.columns.forEach((c) => keywords.add(c.column_name));
    });
    return Array.from(keywords).map((label) => ({
      label,
      kind: 14, // CompletionItemKind.Keyword
      insertText: label,
    }));
  }, [tables, currentSchema]);

  const handleCopySQL = () => {
    navigator.clipboard.writeText(sqlQuery);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 bg-black rounded-full"></div>
            <h3 className="text-sm font-medium text-gray-900">
              AI SQL Assistant
            </h3>
          </div>
          <div className="flex space-x-1">
            <button
              onClick={() => setShowFavorites(!showFavorites)}
              className="p-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
              title="Favorites">
              <Star className="h-3 w-3" />
            </button>
            <button
              onClick={() => setShowTableContext(!showTableContext)}
              className="p-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
              title="Toggle tables">
              Tables
            </button>
          </div>
        </div>

        {/* Table Context */}
        {showTableContext && tables.length > 0 && (
          <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded max-h-32 overflow-y-auto">
            <div className="mb-1">
              <span className="text-xs font-medium text-gray-700">
                Tables ({currentSchema}) - {tables.length} total
              </span>
            </div>
            <div className="space-y-1 text-xs">
              {tables.slice(0, 6).map((table) => (
                <div key={table.table_name} className="text-xs text-gray-600">
                  <span className="font-mono font-medium">
                    {table.table_name}
                  </span>
                  <span className="text-gray-400 ml-1">
                    ({table.columns.length} cols)
                  </span>
                </div>
              ))}
              {tables.length > 6 && (
                <div className="text-xs text-gray-400">
                  +{tables.length - 6} more tables
                </div>
              )}
            </div>
          </div>
        )}

        {/* Favorites Section */}
        {showFavorites && (
          <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded max-h-40 overflow-y-auto">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-900">
                Saved Queries ({favorites.length})
              </span>
            </div>
            {favorites.length > 0 ? (
              <div className="space-y-1">
                {favorites.map((favorite) => (
                  <div
                    key={favorite.id}
                    className="flex items-center justify-between group">
                    <button
                      onClick={() => loadFavoriteQuery(favorite)}
                      className="flex-1 text-left text-xs text-gray-900 hover:text-black hover:bg-gray-100 p-1 rounded truncate"
                      title={favorite.description || favorite.sql}>
                      {favorite.name}
                    </button>
                    <button
                      onClick={() => deleteFavorite(favorite.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-black transition-opacity"
                      title="Delete favorite">
                      <StarOff className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-500 italic">
                No saved queries yet. Save a query to see it here.
              </div>
            )}
          </div>
        )}

        {/* AI Input Section */}
        {showAIInput && (
          <div className="space-y-3">
            <div className="space-y-3">
              <Textarea
                placeholder="Describe what you want to query in plain English..."
                value={naturalLanguage}
                onChange={(e) => setNaturalLanguage(e.target.value)}
                className="min-h-[60px] sm:min-h-[80px] resize-none bg-white border border-gray-300 focus:ring-1 focus:ring-gray-400 text-sm"
              />

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleGenerateSQL}
                  disabled={!naturalLanguage.trim() || isGenerating}
                  className={`flex-1 px-4 py-2 border rounded font-medium text-sm transition-colors ${
                    isGenerating
                      ? "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed"
                      : !naturalLanguage.trim()
                      ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                      : "bg-black border-black text-white hover:bg-gray-800"
                  }`}>
                  {isGenerating ? (
                    <div className="flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2"></div>
                      Generating...
                    </div>
                  ) : (
                    "Generate SQL"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowAIInput(false);
                    if (!sqlQuery) {
                      setSqlQuery(
                        "-- Enter your SQL query here\nSELECT * FROM "
                      );
                    }
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 rounded text-sm transition-colors sm:flex-shrink-0">
                  Manual SQL
                </button>
              </div>
            </div>

            {/* Query History */}
            <div className="hidden sm:block">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">
                  Query History {selectedTable && `(${selectedTable.table})`}
                </p>
                <button
                  onClick={loadQueryHistory}
                  className="p-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                  title="Refresh history">
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto">
                {queryHistory.length > 0 ? (
                  queryHistory.map((history) => (
                    <div
                      key={history.id}
                      className="flex items-center justify-between group hover:bg-gray-100 p-1 rounded">
                      <button
                        onClick={() => loadHistoryQuery(history)}
                        className="flex-1 text-left text-xs text-gray-900 hover:text-black truncate pr-2"
                        title={history.sql}>
                        <span className="font-medium">
                          {history.title || history.sql}
                        </span>
                      </button>
                      {deleteConfirmId === history.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDeleteHistory(history.id)}
                            className="p-0.5 text-red-600 hover:text-red-800"
                            title="Confirm delete">
                            <Trash2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="p-0.5 text-gray-600 hover:text-gray-900"
                            title="Cancel">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(history.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-600 transition-opacity"
                          title="Delete from history">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-gray-500 italic p-2 text-center">
                    No query history yet. Execute queries to build history.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SQL Editor */}
      {!showAIInput && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-shrink-0 p-3 border-b border-gray-200 bg-gray-50">
            {/* Primary Action Row - Always visible */}
            <div className="flex justify-between items-center gap-2 mb-2">
              <button
                onClick={() => setShowAIInput(true)}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 rounded text-sm flex-shrink-0">
                AI Mode
              </button>
              <button
                onClick={handleExecuteSQL}
                disabled={!sqlQuery.trim() || isExecuting}
                className="bg-black hover:bg-gray-800 text-white px-4 py-1.5 rounded text-sm disabled:bg-gray-400 disabled:cursor-not-allowed flex-shrink-0 font-medium">
                {isExecuting ? "Executing..." : "Run Query"}
              </button>
            </div>

            {/* Secondary Actions Row - Conditional */}
            {sqlQuery && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleClear}
                  className="px-2 py-1 border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 rounded text-xs">
                  Clear
                </button>
                <button
                  onClick={handleCopySQL}
                  className="px-2 py-1 border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 rounded text-xs">
                  Copy
                </button>
                <button
                  onClick={() => setShowSaveFavorite(true)}
                  className="px-2 py-1 border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 rounded text-xs flex items-center"
                  title="Save as favorite">
                  <Save className="h-3 w-3 mr-1" />
                  Save
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <Editor
              height="160px"
              defaultLanguage="sql"
              value={sqlQuery}
              onChange={(value) => setSqlQuery(value || "")}
              theme="light"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
              }}
              onMount={(editor, monaco) => {
                monaco.languages.registerCompletionItemProvider("sql", {
                  provideCompletionItems: (model, position) => {
                    const word = model.getWordUntilPosition(position);
                    const range = {
                      startLineNumber: position.lineNumber,
                      endLineNumber: position.lineNumber,
                      startColumn: word.startColumn,
                      endColumn: word.endColumn,
                    };

                    return {
                      suggestions: monacoCompletionProvider.map((item) => ({
                        ...item,
                        range,
                      })),
                    };
                  },
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="flex-shrink-0 p-3 bg-gray-50 border-t border-gray-200">
          <div className="flex items-start">
            <span className="mr-2 text-black flex-shrink-0">!</span>
            <div className="text-sm text-gray-900">{error}</div>
          </div>
        </div>
      )}

      {/* Save Favorite Modal */}
      {showSaveFavorite && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-80 max-w-sm mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-3">
              Save Query as Favorite
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={favoriteName}
                  onChange={(e) => setFavoriteName(e.target.value)}
                  placeholder="e.g., Recent Users Query"
                  className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={favoriteDescription}
                  onChange={(e) => setFavoriteDescription(e.target.value)}
                  placeholder="Brief description of what this query does"
                  className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div className="flex space-x-2 pt-2">
                <button
                  onClick={saveFavorite}
                  disabled={!favoriteName.trim()}
                  className="flex-1 bg-black text-white px-3 py-2 rounded text-sm disabled:bg-gray-300 disabled:cursor-not-allowed">
                  Save Favorite
                </button>
                <button
                  onClick={() => {
                    setShowSaveFavorite(false);
                    setFavoriteName("");
                    setFavoriteDescription("");
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 px-3 py-2 rounded text-sm hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
