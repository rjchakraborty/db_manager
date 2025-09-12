"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DatabaseConnection } from "@/types/database";
import { secureStorage } from "@/lib/encryption";
import { generateId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  Plus,
  Edit2,
  Trash2,
  Database,
  TestTube,
  Eye,
  EyeOff,
  Star,
  StarOff,
  RefreshCw,
} from "lucide-react";

const CONNECTIONS_STORAGE_KEY = "db-connections";
const DEFAULT_CONNECTION_KEY = "default-connection-id";
const GEMINI_API_KEY_STORAGE = "gemini-api-key";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionSelect?: (connection: DatabaseConnection) => Promise<void>;
  currentConnectionId?: string;
  onConnectionTest?: (connection: DatabaseConnection) => Promise<boolean>;
}

export default function SettingsModal({
  isOpen,
  onClose,
  onConnectionSelect,
  currentConnectionId,
  onConnectionTest,
}: SettingsModalProps) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [defaultConnectionId, setDefaultConnectionId] = useState<string | null>(
    null
  );
  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] =
    useState<DatabaseConnection | null>(null);
  const [formData, setFormData] = useState<Partial<DatabaseConnection>>({
    name: "",
    host: "",
    port: 5432,
    database: "",
    username: "",
    password: "",
    ssl: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [useConnectionUrl, setUseConnectionUrl] = useState(false);
  const [connectionUrl, setConnectionUrl] = useState("");
  const [urlParseError, setUrlParseError] = useState<string | null>(null);
  const [schemaCacheStatus, setSchemaCacheStatus] = useState<Map<string, boolean>>(new Map());
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);



  const checkSchemaCacheStatus = useCallback(() => {
    try {
      const cached = localStorage.getItem('db-schema-cache');
      if (cached) {
        const parsedCache = JSON.parse(cached);
        const statusMap = new Map();

        connections.forEach(conn => {
          const hasCache = parsedCache[conn.id] &&
            (Date.now() - parsedCache[conn.id].timestamp < 24 * 60 * 60 * 1000);
          statusMap.set(conn.id, hasCache);
        });

        setSchemaCacheStatus(statusMap);
      }
    } catch (error) {
      console.error('Error checking schema cache status:', error);
    }
  }, [connections]);

  const loadConnections = () => {
    try {
      const stored = secureStorage.get<DatabaseConnection[]>(
        CONNECTIONS_STORAGE_KEY
      );
      if (stored) {
        setConnections(stored);
      }
    } catch (error) {
      console.error("Error loading connections:", error);
      setConnections([]);
    }
  };

  const loadDefaultConnection = () => {
    try {
      const defaultId = secureStorage.get<string>(DEFAULT_CONNECTION_KEY);
      setDefaultConnectionId(defaultId);
    } catch (error) {
      console.error("Error loading default connection:", error);
      setDefaultConnectionId(null);
    }
  };

  const loadGeminiApiKey = () => {
    try {
      // Try plain localStorage first for reliability
      let storedKey = null;
      if (typeof window !== "undefined" && window.localStorage) {
        storedKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
      }

      // Fallback to encrypted storage for backward compatibility
      if (!storedKey) {
        storedKey = secureStorage.get<string>(GEMINI_API_KEY_STORAGE);
        // If found in encrypted storage, migrate to plain storage
        if (storedKey && typeof window !== "undefined" && window.localStorage) {
          localStorage.setItem(GEMINI_API_KEY_STORAGE, storedKey);
          secureStorage.remove(GEMINI_API_KEY_STORAGE);
        }
      }

      if (storedKey) {
        setGeminiApiKey(storedKey);
        setShowApiKeyInput(false);
      } else {
        setShowApiKeyInput(false);
      }
    } catch (error) {
      console.error("Error loading Gemini API key:", error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadConnections();
      loadDefaultConnection();
      checkSchemaCacheStatus();
      loadGeminiApiKey();
    }
  }, [isOpen, checkSchemaCacheStatus]);

  const saveGeminiApiKey = (keyValue?: string) => {
    const keyToSave = keyValue || geminiApiKey;
    if (keyToSave.trim()) {
      // Store API key in plain localStorage for reliability (it's already a user-provided secret)
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, keyToSave.trim());
        console.log('API key saved to localStorage:', keyToSave.substring(0, 10) + '...');

        // Immediate verification
        const verification = localStorage.getItem(GEMINI_API_KEY_STORAGE);
        console.log('Immediate verification - API key retrieved:', verification ? 'Success' : 'Failed');
      }
      setShowApiKeyInput(false);
    }
  };

  const handleApiKeyChange = (value: string) => {
    setGeminiApiKey(value);

    // Auto-save if the value looks like a valid API key (starts with "AIza" and is reasonably long)
    if (value.trim().startsWith('AIza') && value.trim().length > 30) {
      console.log('Auto-saving API key on paste/input');
      saveGeminiApiKey(value);
    }
  };

  const clearGeminiApiKey = () => {
    // Clear from both plain and encrypted storage
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    }
    secureStorage.remove(GEMINI_API_KEY_STORAGE);
    setGeminiApiKey("");
    setShowApiKeyInput(true);
  };

  const parseConnectionUrl = (url: string): Partial<DatabaseConnection> | null => {
    try {
      // Validate URL format
      if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
        throw new Error('URL must start with postgresql:// or postgres://');
      }

      const parsedUrl = new URL(url);

      if (!parsedUrl.hostname) {
        throw new Error('Invalid hostname in URL');
      }

      if (!parsedUrl.username || !parsedUrl.password) {
        throw new Error('Username and password are required in URL');
      }

      if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
        throw new Error('Database name is required in URL path');
      }

      const database = parsedUrl.pathname.slice(1); // Remove leading slash
      const port = parsedUrl.port ? parseInt(parsedUrl.port) : 5432;

      // Check for SSL parameter
      const ssl = parsedUrl.searchParams.get('sslmode') === 'require' ||
        parsedUrl.searchParams.get('ssl') === 'true';

      return {
        host: parsedUrl.hostname,
        port: port,
        database: database,
        username: parsedUrl.username,
        password: decodeURIComponent(parsedUrl.password),
        ssl: ssl,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid connection URL format';
      setUrlParseError(errorMessage);
      return null;
    }
  };

  const handleUrlChange = (url: string) => {
    setConnectionUrl(url);
    setUrlParseError(null);

    if (url.trim()) {
      const parsed = parseConnectionUrl(url);
      if (parsed) {
        // Auto-generate connection name from host and database
        const autoName = `${parsed.host}/${parsed.database}`;
        setFormData({
          ...parsed,
          name: formData.name || autoName,
        });
      }
    }
  };

  const saveConnections = (updatedConnections: DatabaseConnection[]) => {
    try {
      secureStorage.set(CONNECTIONS_STORAGE_KEY, updatedConnections);
      setConnections(updatedConnections);

      // If there's only one connection, make it default automatically
      if (updatedConnections.length === 1) {
        setDefaultConnection(updatedConnections[0].id);
      } else if (updatedConnections.length === 0) {
        // Clear default if no connections
        secureStorage.remove(DEFAULT_CONNECTION_KEY);
        setDefaultConnectionId(null);
      }
    } catch (error) {
      console.error("Error saving connections:", error);
      alert("Failed to save connection securely. Please try again.");
    }
  };

  const setDefaultConnection = (connectionId: string) => {
    try {
      secureStorage.set(DEFAULT_CONNECTION_KEY, connectionId);
      setDefaultConnectionId(connectionId);
    } catch (error) {
      console.error("Error setting default connection:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.name ||
      !formData.host ||
      !formData.database ||
      !formData.username ||
      !formData.password
    ) {
      alert("Please fill in all required fields");
      return;
    }

    const connectionData: DatabaseConnection = {
      id: editingConnection?.id || generateId(),
      name: formData.name!,
      host: formData.host!,
      port: formData.port || 5432,
      database: formData.database!,
      username: formData.username!,
      password: formData.password!,
      ssl: formData.ssl || false,
      createdAt: editingConnection?.createdAt || new Date(),
    };

    let updatedConnections;
    if (editingConnection) {
      updatedConnections = connections.map((conn) =>
        conn.id === editingConnection.id ? connectionData : conn
      );
    } else {
      updatedConnections = [...connections, connectionData];
    }

    saveConnections(updatedConnections);
    resetForm();
  };

  const handleEdit = (connection: DatabaseConnection) => {
    setEditingConnection(connection);
    setFormData({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl: connection.ssl,
    });
    setShowForm(true);
    setTestResult(null);
  };

  const handleDelete = (connectionId: string) => {
    if (confirm("Are you sure you want to delete this connection?")) {
      const updatedConnections = connections.filter(
        (conn) => conn.id !== connectionId
      );
      saveConnections(updatedConnections);

      // Clear default if this was the default connection
      if (defaultConnectionId === connectionId) {
        secureStorage.remove(DEFAULT_CONNECTION_KEY);
        setDefaultConnectionId(null);
      }
    }
  };

  const handleConnect = async (connection: DatabaseConnection) => {
    if (onConnectionSelect) {
      // Show connecting state
      setTestingConnection(true);
      setTestResult({ success: true, message: "Connecting and loading schema..." });

      try {
        await onConnectionSelect(connection);
        setTestResult({ success: true, message: "Connected successfully! Schema cached for faster loading." });

        // Small delay to show success message
        setTimeout(() => {
          onClose();
          setTestingConnection(false);
          setTestResult(null);
        }, 1500);
      } catch (error: unknown) {
        setTestResult({
          success: false,
          message: error instanceof Error ? error.message : "Failed to connect"
        });
        setTestingConnection(false);
      }
    } else {
      onClose();
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingConnection(null);
    setFormData({
      name: "",
      host: "",
      port: 5432,
      database: "",
      username: "",
      password: "",
      ssl: false,
    });
    setShowPassword(false);
    setTestResult(null);
    setUseConnectionUrl(false);
    setConnectionUrl("");
    setUrlParseError(null);
  };

  const handleTestConnection = async () => {
    if (
      !formData.host ||
      !formData.database ||
      !formData.username ||
      !formData.password
    ) {
      setTestResult({
        success: false,
        message: "Please fill in all required fields",
      });
      return;
    }

    setTestingConnection(true);
    setTestResult(null);

    try {
      const testConnection: DatabaseConnection = {
        id: "test",
        name: "Test Connection",
        host: formData.host!.trim(),
        port: formData.port || 5432,
        database: formData.database!.trim(),
        username: formData.username!.trim(),
        password: formData.password!,
        ssl: formData.ssl || false,
        createdAt: new Date(),
      };

      // Use the callback if provided, otherwise fall back to direct API call
      if (onConnectionTest) {
        const success = await onConnectionTest(testConnection);
        setTestResult({
          success,
          message: success ? "Connection successful!" : "Connection failed"
        });
      } else {
        // Fallback to direct API call
        const response = await fetch("/api/database/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(testConnection),
        });

        const result = await response.json();
        setTestResult({
          success: result.success,
          message: result.success ? "Connection successful!" : (result.error || "Connection failed")
        });
      }
    } catch (error: unknown) {
      console.error("Test connection error:", error);
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to test connection"
      });
    } finally {
      setTestingConnection(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className="bg-white h-full w-full max-w-2xl shadow-xl border-l border-black overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-black">
          <div className="flex items-center">
            <Database className="mr-3 h-6 w-6" />
            <h2 className="text-xl font-semibold text-black">
              Database Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {/* Add Connection Button */}
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-medium text-black">
              Database Connections
            </h3>
            <Button
              onClick={() => setShowForm(true)}
              size="sm"
              variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              Add Connection
            </Button>
          </div>

          {/* Connection List */}
          <div className="space-y-3 mb-6">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className={`p-4 border rounded-lg ${currentConnectionId === connection.id
                  ? "border-black bg-gray-50"
                  : "border-gray-200"
                  }`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h4 className="font-medium text-black">
                        {connection.name}
                      </h4>
                      {defaultConnectionId === connection.id && (
                        <Star className="h-4 w-4 ml-2 text-black fill-current" />
                      )}
                      {schemaCacheStatus.get(connection.id) && (
                        <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-900 text-xs rounded-full">
                          Cached
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {connection.username}@{connection.host}:{connection.port}/
                      {connection.database}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {connections.length > 1 && (
                      <button
                        onClick={() => setDefaultConnection(connection.id)}
                        className="p-1 text-gray-400 hover:text-black transition-colors"
                        title={
                          defaultConnectionId === connection.id
                            ? "Default connection"
                            : "Set as default"
                        }>
                        {defaultConnectionId === connection.id ? (
                          <Star className="h-4 w-4 fill-current" />
                        ) : (
                          <StarOff className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleConnect(connection)}
                      className="px-3 py-1 text-sm bg-black text-white rounded hover:bg-gray-800 transition-colors">
                      Connect
                    </button>
                    <button
                      onClick={() => handleEdit(connection)}
                      className="p-1 text-gray-400 hover:text-black transition-colors">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(connection.id)}
                      className="p-1 text-gray-400 hover:text-black transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {connections.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No database connections configured</p>
                <p className="text-sm">
                  Add your first connection to get started
                </p>
              </div>
            )}
          </div>

          {/* Connection Form */}
          {showForm && (
            <div className="border border-black rounded-lg p-6 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-black">
                  {editingConnection ? "Edit Connection" : "Add New Connection"}
                </h3>
                <button
                  onClick={resetForm}
                  className="p-1 text-gray-400 hover:text-black transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Input Method Toggle */}
              <div className="mb-6">
                <div className="flex items-center space-x-4 mb-4">
                  <button
                    type="button"
                    onClick={() => setUseConnectionUrl(false)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${!useConnectionUrl
                      ? 'bg-black text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}>
                    Manual Configuration
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseConnectionUrl(true)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${useConnectionUrl
                      ? 'bg-black text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}>
                    Connection URL
                  </button>
                </div>

                {useConnectionUrl && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-black">
                        PostgreSQL Connection URL *
                      </label>
                      <Input
                        type="text"
                        value={connectionUrl}
                        onChange={(e) => handleUrlChange(e.target.value)}
                        placeholder="postgresql://username:password@host:port/database"
                        className="font-mono text-sm"
                      />
                      {urlParseError && (
                        <p className="mt-1 text-sm text-gray-900">{urlParseError}</p>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 bg-gray-100 p-3 rounded">
                      <p className="font-medium mb-1">Example:</p>
                      <code className="text-xs">
                        postgresql://user:pass@localhost:5432/mydb
                      </code>
                    </div>

                    {connectionUrl && !urlParseError && formData.host && (
                      <div className="bg-gray-50 border border-gray-200 p-3 rounded">
                        <p className="text-sm font-medium text-gray-900 mb-2">
                          ✓ Connection URL parsed successfully:
                        </p>
                        <div className="text-xs text-gray-700 space-y-1">
                          <div><strong>Host:</strong> {formData.host}:{formData.port}</div>
                          <div><strong>Database:</strong> {formData.database}</div>
                          <div><strong>Username:</strong> {formData.username}</div>
                          <div><strong>SSL:</strong> {formData.ssl ? 'Enabled' : 'Disabled'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-black">
                      Connection Name *
                    </label>
                    <Input
                      type="text"
                      value={formData.name || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="My Database"
                      required
                    />
                  </div>

                  {!useConnectionUrl && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1 text-black">
                          Host *
                        </label>
                        <Input
                          type="text"
                          value={formData.host || ""}
                          onChange={(e) =>
                            setFormData({ ...formData, host: e.target.value })
                          }
                          placeholder="localhost"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1 text-black">
                          Port
                        </label>
                        <Input
                          type="number"
                          value={formData.port || 5432}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              port: parseInt(e.target.value) || 5432,
                            })
                          }
                          placeholder="5432"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1 text-black">
                          Database *
                        </label>
                        <Input
                          type="text"
                          value={formData.database || ""}
                          onChange={(e) =>
                            setFormData({ ...formData, database: e.target.value })
                          }
                          placeholder="mydb"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1 text-black">
                          Username *
                        </label>
                        <Input
                          type="text"
                          value={formData.username || ""}
                          onChange={(e) =>
                            setFormData({ ...formData, username: e.target.value })
                          }
                          placeholder="username"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1 text-black">
                          Password *
                        </label>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            value={formData.password || ""}
                            onChange={(e) =>
                              setFormData({ ...formData, password: e.target.value })
                            }
                            placeholder="password"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black">
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="ssl"
                    checked={formData.ssl || false}
                    onChange={(e) =>
                      setFormData({ ...formData, ssl: e.target.checked })
                    }
                    className="mr-2"
                  />
                  <label htmlFor="ssl" className="text-sm text-black">
                    Enable SSL
                  </label>
                </div>

                {/* Test Result */}
                {testResult && (
                  <div
                    className={`p-3 rounded text-sm ${testResult.success
                      ? "bg-gray-100 text-gray-900 border border-gray-200"
                      : "bg-gray-100 text-gray-900 border border-gray-200"
                      }`}>
                    {testResult.message}
                  </div>
                )}

                <div className="flex justify-end space-x-3 pt-4">
                  <Button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    variant="outline"
                    size="sm">
                    {testingConnection ? (
                      <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4 mr-1" />
                    )}
                    Test Connection
                  </Button>

                  <Button type="submit" size="sm">
                    {editingConnection
                      ? "Update Connection"
                      : "Save Connection"}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* AI Configuration Section */}
          <div className="mt-8 border-t border-gray-200 pt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-black">AI Configuration</h3>
              {geminiApiKey && !showApiKeyInput && (
                <button
                  onClick={() => setShowApiKeyInput(true)}
                  className="text-sm text-gray-600 hover:text-black transition-colors">
                  Change API Key
                </button>
              )}
            </div>

            {showApiKeyInput || !geminiApiKey ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-black">
                    Gemini API Key
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      onPaste={(e) => {
                        // Handle paste event specifically
                        setTimeout(() => {
                          const pastedValue = (e.target as HTMLInputElement).value;
                          console.log('Paste detected, value length:', pastedValue.length);
                          handleApiKeyChange(pastedValue);
                        }, 10);
                      }}
                      placeholder="Enter your Gemini API key"
                      className="flex-1 input-base"
                    />
                    <button
                      onClick={() => saveGeminiApiKey()}
                      disabled={!geminiApiKey.trim()}
                      className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                      Save
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Required for AI-powered SQL generation. Get your API key from{" "}
                    <a
                      href="https://makersuite.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-900 hover:text-black underline">
                      Google AI Studio
                    </a>
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded">
                <div className="flex items-center">
                  <div className="h-2 w-2 bg-black rounded-full mr-2"></div>
                  <span className="text-sm text-gray-900">API Key configured</span>
                </div>
                <button
                  onClick={clearGeminiApiKey}
                  className="text-sm text-gray-600 hover:text-black transition-colors">
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
