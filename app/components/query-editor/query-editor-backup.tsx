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
} from "lucide-react";
import { QueryResult, QueryError } from "@/types/database";
import { copyToClipboard, downloadAsFile } from "@/lib/utils";

interface QueryEditorProps {
  connectionId?: string;
  initialQuery?: string;
  onQueryExecute?: (query: string) => Promise<QueryResult>;
}

export default function QueryEditor({
  connectionId,
  initialQuery = "",
  onQueryExecute,
}: QueryEditorProps) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<QueryError | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showAIInput, setShowAIInput] = useState(false);
  const [aiInput, setAIInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Configure PostgreSQL syntax highlighting
    monaco.languages.setMonarchTokensProvider('sql', {
      keywords: [
        'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
        'GROUP', 'BY', 'ORDER', 'HAVING', 'UNION', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'VIEW',
        'DATABASE', 'SCHEMA', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'BEGIN', 'END',
        'AS', 'ON', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'AND', 'OR', 'NOT', 'DISTINCT',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'IF', 'LIMIT', 'OFFSET', 'WITH', 'RECURSIVE'
      ],
      operators: ['=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '<>', '+=', '-=', '*=', '/=', '%=', '&=', '^=', '|=', '<<', '>>', '||', '&&', '++', '--', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>='],
      symbols: /[=><!~?:&|+\-*\/\^%]+/,
      tokenizer: {
        root: [
          [/[a-z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/[A-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'type.identifier' } }],
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
          [/'([^'\\]|\\.)*$/, 'string.invalid'],
          [/'/, { token: 'string.quote', bracket: '@open', next: '@stringsingle' }],
          [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
          [/0[xX][0-9a-fA-F]+/, 'number.hex'],
          [/\d+/, 'number'],
          [/[;,.]/, 'delimiter'],
          [/[()]/, '@brackets'],
          [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
          [/[ \t\r\n]+/, 'white'],
          [/--.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\/\*/, 'comment', '@push'],
          ["\\*/", 'comment', '@pop'],
          [/[\/*]/, 'comment']
        ],
        string: [
          [/[^\\"]+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape.invalid'],
          [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
        ],
        stringsingle: [
          [/[^\\']+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape.invalid'],
          [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
        ],
      }
    });
  };

  const handleExecuteQuery = useCallback(async () => {
    if (!query.trim() || !onQueryExecute) return;

    setIsExecuting(true);
    setError(null);

    try {
      const result = await onQueryExecute(query);
      setResult(result);
    } catch (err: any) {
      console.error("Query execution error:", err);
      setError(err);
    } finally {
      setIsExecuting(false);
    }
  }, [query, onQueryExecute]);

  const handleGenerateSQL = useCallback(async () => {
    if (!aiInput.trim()) return;

    setIsGenerating(true);
    try {
      // This is simplified - no AI integration in query editor anymore
      // AI functionality will be handled by the AI Assistant sidebar
    } catch (err: any) {
      console.error("AI query generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  }, [aiInput]);

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
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
      downloadAsFile(csvContent, `query-result-${timestamp}.csv`, "text/csv");
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-black rounded-lg shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-lg font-medium">SQL Query Editor</h3>
        <div className="flex space-x-2">
          <Button onClick={handleCopyQuery} variant="outline" size="sm">
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </Button>
          <Button onClick={handleSaveQuery} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Save
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
            folding: true,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
          }}
        />

        {/* Action Buttons */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-white">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">
              Use the AI Assistant sidebar for natural language queries
            </span>
          </div>
          <div className="flex space-x-2">
            <Button onClick={handleClearQuery} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button
              onClick={handleExecuteQuery}
              disabled={!query.trim() || isExecuting}
              className="bg-black hover:bg-gray-800 text-white"
            >
              <Play className="h-4 w-4 mr-1" />
              {isExecuting ? "Executing..." : "Run Query"}
            </Button>
          </div>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="flex-1 border-t border-gray-200">
            {error ? (
              <div className="p-4 bg-red-50 border-l-4 border-red-500">
                <div className="flex items-start">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-red-800">
                      Query Error
                    </h3>
                    <p className="mt-1 text-sm text-red-700">{error.message}</p>
                    {error.detail && (
                      <p className="mt-1 text-sm text-red-600">
                        Detail: {error.detail}
                      </p>
                    )}
                    {error.hint && (
                      <p className="mt-1 text-sm text-red-600">
                        Hint: {error.hint}
                      </p>
                    )}
                    {error.position && (
                      <p className="mt-1 text-sm text-red-600">
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
      </div>
    </div>
  );
}
