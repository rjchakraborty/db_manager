"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Download,
  Copy,
  RotateCcw,
  Sparkles,
  Star,
  StarOff,
  Save,
} from "lucide-react";
import { QueryResult, QueryError, DatabaseTable } from "@/types/database";
import { copyToClipboard, downloadAsFile } from "@/lib/utils";
import { FavoritesManager, FavoriteQuery } from "@/lib/favorites";
import { SQLIntelligenceProvider, AIRateLimiter } from "@/lib/sql-intelligence";

interface QueryEditorProps {
  connectionId?: string;
  initialQuery?: string;
  generatedSQL?: string; // New prop for AI-generated SQL
  onQueryExecute: (query: string) => Promise<QueryResult>;
  onAIQuery?: (naturalLanguage: string) => Promise<string>;
  isAIEnabled?: boolean;
  tables?: DatabaseTable[]; // Schema data for intelligent suggestions
  currentSchema?: string;
}

export default function QueryEditor({
  connectionId,
  initialQuery = "",
  generatedSQL,
  onQueryExecute,
  onAIQuery,
  isAIEnabled = false,
  tables = [],
  currentSchema = "public",
}: QueryEditorProps) {
  const [query, setQuery] = useState(initialQuery);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<QueryError | null>(null);
  const [aiInput, setAIInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAIInput, setShowAIInput] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteQuery[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSaveFavorite, setShowSaveFavorite] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteDescription, setFavoriteDescription] = useState("");

  const editorRef = useRef<any>(null);
  const sqlIntelligence = useRef<SQLIntelligenceProvider>(new SQLIntelligenceProvider(tables, currentSchema));
  const aiRateLimiter = useRef<AIRateLimiter>(new AIRateLimiter(5, 1)); // 5 calls per minute

  // Load favorites when component mounts or connection changes
  useEffect(() => {
    if (connectionId) {
      loadFavorites();
    }
  }, [connectionId]);

  const loadFavorites = () => {
    if (connectionId) {
      const connectionFavorites = FavoritesManager.getFavorites(connectionId);
      setFavorites(connectionFavorites);
    }
  };

  const saveFavorite = () => {
    if (!connectionId || !query.trim() || !favoriteName.trim()) return;

    try {
      FavoritesManager.saveFavorite({
        connectionId,
        name: favoriteName.trim(),
        sql: query.trim(),
        description: favoriteDescription.trim()
      });

      loadFavorites(); // Refresh favorites list
      setShowSaveFavorite(false);
      setFavoriteName("");
      setFavoriteDescription("");
    } catch (error) {
      console.error("Error saving favorite:", error);
      setError({ message: "Failed to save favorite query", code: "SAVE_ERROR" });
    }
  };

  const deleteFavorite = (favoriteId: string) => {
    if (FavoritesManager.deleteFavorite(favoriteId)) {
      loadFavorites(); // Refresh favorites list
    }
  };

  const loadFavoriteQuery = (favorite: FavoriteQuery) => {
    setQuery(favorite.sql);
    setShowFavorites(false);
    // Clear any previous results/errors
    setResult(null);
    setError(null);
  };

  // Update query when generated SQL changes
  useEffect(() => {
    if (generatedSQL) {
      setQuery(generatedSQL);
      setShowAIInput(false);
      // Clear any previous results/errors
      setResult(null);
      setError(null);
    }
  }, [generatedSQL]);

  // Update SQL intelligence when tables or schema change
  useEffect(() => {
    sqlIntelligence.current.updateSchema(tables, currentSchema);
  }, [tables, currentSchema]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Configure SQL language features
    monaco.languages.setLanguageConfiguration("sql", {
      comments: {
        lineComment: "--",
        blockComment: ["/*", "*/"],
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    // Register intelligent completion provider
    monaco.languages.registerCompletionItemProvider("sql", {
      provideCompletionItems: (model, position) => {
        const completions = sqlIntelligence.current.getCompletions(model, position);
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );

        return {
          suggestions: completions.map(completion => ({
            label: completion.label,
            kind: monaco.languages.CompletionItemKind[completion.kind as keyof typeof monaco.languages.CompletionItemKind] || monaco.languages.CompletionItemKind.Text,
            insertText: completion.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: completion.detail,
            documentation: completion.documentation,
            sortText: completion.sortText,
            range: range,
          }))
        };
      }
    });

    // Register hover provider
    monaco.languages.registerHoverProvider("sql", {
      provideHover: (model, position) => {
        const hoverInfo = sqlIntelligence.current.getHoverInfo(model, position);
        if (hoverInfo) {
          return {
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            contents: [{ value: hoverInfo }]
          };
        }
        return null;
      }
    });

    // Enhanced SQL syntax highlighting
    monaco.languages.setMonarchTokensProvider('sql', {
      keywords: [
        'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
        'GROUP', 'BY', 'ORDER', 'HAVING', 'UNION', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'VIEW',
        'DATABASE', 'SCHEMA', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'BEGIN', 'END',
        'AS', 'ON', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'AND', 'OR', 'NOT', 'DISTINCT',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'IF', 'LIMIT', 'OFFSET', 'WITH', 'RECURSIVE', 'RETURNING'
      ],
      operators: [
        '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
        '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
        '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
        '%=', '<<=', '>>=', '>>>='
      ],
      symbols: /[=><!~?:&|+\-*\/\^%]+/,
      tokenizer: {
        root: [
          [/[a-z_$][\w$]*/, {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier'
            }
          }],
          [/[A-Z][\w\$]*/, 'type.identifier'],
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/'([^'\\]|\\.)*$/, 'string.invalid'],
          [/"/, 'string', '@string_double'],
          [/'/, 'string', '@string_single'],
          [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
          [/0[xX][0-9a-fA-F]+/, 'number.hex'],
          [/\d+/, 'number'],
          [/[;,.]/, 'delimiter'],
          [/[()[\]]/, '@brackets'],
          [/[{}]/, 'delimiter.bracket'],
          [/@symbols/, {
            cases: {
              '@operators': 'operator',
              '@default': ''
            }
          }],
          [/--.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment']
        ],
        string_double: [
          [/[^\\"]+/, 'string'],
          [/"/, 'string', '@pop']
        ],
        string_single: [
          [/[^\\']+/, 'string'],
          [/'/, 'string', '@pop']
        ]
      }
    });

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleExecuteQuery();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveQuery();
    });

    // Add format document command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      editor.getAction('editor.action.formatDocument')?.run();
    });
  };

  const handleExecuteQuery = useCallback(async () => {
    if (!connectionId || !query.trim()) return;

    setIsExecuting(true);
    setResult(null);
    setError(null);

    try {
      const result = await onQueryExecute(query);
      setResult(result);
    } catch (err: any) {
      setError(err);
    } finally {
      setIsExecuting(false);
    }
  }, [connectionId, query, onQueryExecute]);

  const handleGenerateSQL = useCallback(async () => {
    if (!onAIQuery || !aiInput.trim()) return;

    // Check rate limiting
    if (!aiRateLimiter.current.canMakeCall()) {
      const timeUntilNext = aiRateLimiter.current.getTimeUntilNextCall();
      const minutes = Math.ceil(timeUntilNext / 60000);
      setError({
        message: `AI rate limit exceeded. Please wait ${minutes} minute(s) before making another AI request.`,
        code: "RATE_LIMIT_EXCEEDED"
      });
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      aiRateLimiter.current.recordCall();
      const generatedSQL = await onAIQuery(aiInput);
      setQuery(generatedSQL);
      setShowAIInput(false);
    } catch (err: any) {
      console.error("AI query generation failed:", err);
      setError({
        message: err.message || "Failed to generate SQL query",
        code: "AI_GENERATION_ERROR"
      });
    } finally {
      setIsGenerating(false);
    }
  }, [aiInput, onAIQuery]);

  const handleClearEditor = () => {
    setQuery("");
    setResult(null);
    setError(null);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const handleClearQuery = () => {
    setQuery("");
    setResult(null);
    setError(null);
    setAIInput("");
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const handleCopyQuery = () => {
    copyToClipboard(query);
  };

  const handleSaveQuery = () => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    downloadAsFile(query, `query-${timestamp}.sql`, "text/plain");
  };

  const handleCopyResult = () => {
    if (result) {
      const csvContent = [
        result.fields.map((f) => f.name).join(","),
        ...result.rows.map((row) =>
          result.fields
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

  const handleDownloadResult = () => {
    if (result) {
      const csvContent = [
        result.fields.map((f) => f.name).join(","),
        ...result.rows.map((row) =>
          result.fields
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
      downloadAsFile(csvContent, `query-result-${timestamp}.csv`, "text/csv");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
        <div className="flex items-center space-x-2">
          {isAIEnabled && (
            <Button
              variant={showAIInput ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAIInput(!showAIInput)}>
              <Sparkles className="h-4 w-4 mr-1" />
              {showAIInput ? "Hide AI" : "Generate with AI"}
            </Button>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <Button
            onClick={() => setShowFavorites(!showFavorites)}
            variant="outline"
            size="sm"
            title="Favorites">
            <Star className="h-4 w-4 mr-1" />
            Favorites
          </Button>

          {query.trim() && (
            <Button
              onClick={() => setShowSaveFavorite(true)}
              variant="outline"
              size="sm"
              title="Save as favorite">
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
          )}

          <Button onClick={handleClearEditor} variant="outline" size="sm">
            <RotateCcw className="h-4 w-4 mr-1" />
            Clear
          </Button>

          <Button onClick={handleCopyQuery} variant="outline" size="sm">
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </Button>

          <Button onClick={handleSaveQuery} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>

          <Button
            onClick={handleExecuteQuery}
            disabled={!connectionId || !query.trim() || isExecuting}
            size="sm">
            {isExecuting ? (
              <Square className="h-4 w-4 mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            {isExecuting ? "Running..." : "Execute"}
          </Button>
        </div>
      </div>

      {/* AI Input Section (when toggled) */}
      {showAIInput && (
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <div className="flex space-x-3">
            <textarea
              value={aiInput}
              onChange={(e) => setAIInput(e.target.value)}
              placeholder="Describe what you want to query in plain English..."
              className="flex-1 h-24 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
            />
            <Button
              onClick={handleGenerateSQL}
              disabled={!aiInput.trim() || isGenerating}
              size="sm"
              className="self-end">
              <Sparkles className="h-4 w-4 mr-1" />
              {isGenerating ? "Generating..." : "Generate SQL"}
            </Button>
          </div>
          <div className="flex justify-between items-center mt-2">
            <p className="text-sm text-gray-500">
              Example: "Show me all users who registered last month" or "Find the
              top 10 products by sales"
            </p>
            <p className="text-xs text-gray-400">
              AI calls remaining: {aiRateLimiter.current.getRemainingCalls()}/5 per minute
            </p>
          </div>
        </div>
      )}

      {/* SQL Editor */}
      <div className="flex-1 flex flex-col">
        <Editor
          height="300px"
          defaultLanguage="sql"
          value={query}
          onChange={(value) => setQuery(value || "")}
          onMount={handleEditorDidMount}
          theme="light"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            roundedSelection: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            wordWrap: "on",
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            suggestSelection: "first",
            acceptSuggestionOnEnter: "on",
            acceptSuggestionOnCommitCharacter: true,
            snippetSuggestions: "top",
            formatOnPaste: true,
            formatOnType: true,
            colorDecorators: true,
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
            renderWhitespace: "selection",
            renderControlCharacters: false,
            folding: true,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
          }}
        />

        {/* Action Buttons */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-white">
          <div className="flex items-center space-x-4">
            <Button
              onClick={() => setShowAIInput(!showAIInput)}
              variant="outline"
              size="sm"
              className="flex items-center">
              <Sparkles className="h-4 w-4 mr-1" />
              {showAIInput ? "Hide AI" : "Ask AI"}
            </Button>
          </div>
          <div className="flex space-x-2">
            <Button onClick={handleClearQuery} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button
              onClick={handleExecuteQuery}
              disabled={!query.trim() || isExecuting}
              className="bg-black hover:bg-gray-800 text-white">
              <Play className="h-4 w-4 mr-1" />
              {isExecuting ? "Executing..." : "Run Query"}
            </Button>
          </div>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="flex-1 border-t border-gray-200">
            {error ? (
              <div className="p-4 bg-gray-50 border-l-4 border-gray-400">
                <div className="flex items-start">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">
                      Query Error
                    </h3>
                    <p className="mt-1 text-sm text-gray-900">{error.message}</p>
                    {error.detail && (
                      <p className="mt-1 text-sm text-gray-700">
                        Detail: {error.detail}
                      </p>
                    )}
                    {error.hint && (
                      <p className="mt-1 text-sm text-gray-700">
                        Hint: {error.hint}
                      </p>
                    )}
                    {error.position && (
                      <p className="mt-1 text-sm text-gray-700">
                        Position: {error.position}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              result && (
                <div className="flex flex-col h-full">
                  {/* Results Toolbar */}
                  <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
                    <div className="text-sm text-gray-600">
                      {result.rowCount} rows • {result.duration}ms
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        onClick={handleCopyResult}
                        variant="outline"
                        size="sm">
                        <Copy className="h-4 w-4 mr-1" />
                        Copy CSV
                      </Button>
                      <Button
                        onClick={handleDownloadResult}
                        variant="outline"
                        size="sm">
                        <Download className="h-4 w-4 mr-1" />
                        Export CSV
                      </Button>
                    </div>
                  </div>

                  {/* Results Table with Enhanced Scrolling */}
                  <div className="flex-1 overflow-hidden relative">
                    <div className="absolute inset-0 overflow-auto">
                      <div className="min-w-max">
                        <table className="w-full min-w-max">
                          <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                              {result.fields.map((field) => (
                                <th
                                  key={field.name}
                                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 tracking-wider border-b border-gray-200 whitespace-nowrap min-w-[120px] bg-gray-50">
                                  {field.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {result.rows.map((row, index) => (
                              <tr
                                key={index}
                                className={
                                  index % 2 === 0 ? "bg-white" : "bg-gray-50"
                                }>
                                {result.fields.map((field) => (
                                  <td
                                    key={field.name}
                                    className="px-4 py-2 text-sm text-gray-900 border-b border-gray-200 min-w-[120px] max-w-[400px] whitespace-nowrap"
                                    title={String(row[field.name])}>
                                    <div className="truncate cursor-help">
                                      {row[field.name] === null ? (
                                        <span className="text-gray-400 italic">
                                          NULL
                                        </span>
                                      ) : (
                                        String(row[field.name])
                                      )}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* No Data Message */}
                      {result.rows.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white">
                          <div className="text-center py-8 text-gray-500">
                            <p>No rows returned</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Favorites Dropdown */}
        {showFavorites && (
          <div className="absolute top-16 left-4 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-80 max-h-60 overflow-y-auto">
            <div className="p-3 border-b border-gray-200">
              <h3 className="text-sm font-medium text-gray-900">Saved Queries ({favorites.length})</h3>
            </div>
            {favorites.length > 0 ? (
              <div className="p-2">
                {favorites.map((favorite) => (
                  <div key={favorite.id} className="flex items-center justify-between group hover:bg-gray-50 p-2 rounded">
                    <button
                      onClick={() => loadFavoriteQuery(favorite)}
                      className="flex-1 text-left">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {favorite.name}
                      </div>
                      {favorite.description && (
                        <div className="text-xs text-gray-500 truncate">
                          {favorite.description}
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => deleteFavorite(favorite.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-600 hover:text-black transition-opacity"
                      title="Delete favorite">
                      <StarOff className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500 text-sm">
                No saved queries yet. Save a query to see it here.
              </div>
            )}
          </div>
        )}

        {/* Save Favorite Modal */}
        {showSaveFavorite && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96 max-w-sm mx-4">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Save Query as Favorite</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={favoriteName}
                    onChange={(e) => setFavoriteName(e.target.value)}
                    placeholder="e.g., Recent Users Query"
                    className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
                    className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </div>
                <div className="flex space-x-3 pt-2">
                  <Button
                    onClick={saveFavorite}
                    disabled={!favoriteName.trim()}
                    className="flex-1">
                    Save Favorite
                  </Button>
                  <Button
                    onClick={() => {
                      setShowSaveFavorite(false);
                      setFavoriteName("");
                      setFavoriteDescription("");
                    }}
                    variant="outline"
                    className="flex-1">
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
