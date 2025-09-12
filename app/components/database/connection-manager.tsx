"use client";

import React, { useState, useEffect } from "react";
import { DatabaseConnection } from "@/types/database";
import { secureStorage } from "@/lib/encryption";
import { generateId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Edit2,
  Trash2,
  Database,
  TestTube,
  Eye,
  EyeOff,
} from "lucide-react";

const CONNECTIONS_STORAGE_KEY = "db-connections";

interface ConnectionManagerProps {
  onConnectionSelect: (connection: DatabaseConnection) => void;
  selectedConnectionId?: string;
}

export default function ConnectionManager({
  onConnectionSelect,
  selectedConnectionId,
}: ConnectionManagerProps) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
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

  // Load connections from secure storage
  useEffect(() => {
    loadConnections();
  }, []);

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
      // If there's an error loading (e.g., corrupted data), start fresh
      setConnections([]);
    }
  };

  const saveConnections = (updatedConnections: DatabaseConnection[]) => {
    try {
      secureStorage.set(CONNECTIONS_STORAGE_KEY, updatedConnections);
      setConnections(updatedConnections);
    } catch (error) {
      console.error("Error saving connections:", error);
      alert("Failed to save connection securely. Please try again.");
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

      const response = await fetch("/api/database/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testConnection),
      });

      const result = await response.json();

      if (result.success) {
        setTestResult({ success: true, message: "Connection successful!" });
      } else {
        setTestResult({
          success: false,
          message: result.error || "Connection failed",
        });
      }
    } catch (error) {
      console.error("Test connection error:", error);
      setTestResult({ success: false, message: "Failed to test connection" });
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="p-4 border-r border-black bg-white h-full min-w-[300px]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center text-black">
          <Database className="mr-2 h-5 w-5" />
          Connections
        </h2>
        <Button onClick={() => setShowForm(true)} size="sm" variant="outline">
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      {/* Connection List */}
      <div className="space-y-2 mb-4">
        {connections.map((connection) => (
          <div
            key={connection.id}
            className={`p-3 rounded border cursor-pointer transition-colors ${selectedConnectionId === connection.id
                ? "bg-gray-100 border-black"
                : "bg-white border-gray-300 hover:bg-gray-50"
              }`}
            onClick={() => onConnectionSelect(connection)}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate text-black">
                  {connection.name}
                </h3>
                <p className="text-xs text-gray-600 truncate">
                  {connection.username}@{connection.host}:{connection.port}/
                  {connection.database}
                </p>
              </div>
              <div className="flex items-center space-x-1 ml-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(connection);
                  }}
                  className="h-8 w-8">
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(connection.id);
                  }}
                  className="h-8 w-8 text-black hover:text-gray-700">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        {connections.length === 0 && (
          <div className="text-center py-8 text-black">
            <Database className="mx-auto h-12 w-12 text-gray-600 mb-2" />
            <p className="text-sm text-black">No connections yet</p>
            <p className="text-xs text-gray-600">
              Add your first database connection
            </p>
          </div>
        )}
      </div>

      {/* Connection Form Modal/Drawer */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-full max-w-md max-h-[90vh] overflow-y-auto border border-black">
            <h3 className="text-lg font-semibold mb-4 text-black">
              {editingConnection ? "Edit Connection" : "New Connection"}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Connection Name *
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="My Database"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Host *
                </label>
                <Input
                  value={formData.host}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, host: e.target.value }))
                  }
                  placeholder="hostname or IP address"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Port *
                </label>
                <Input
                  type="number"
                  value={formData.port}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      port: parseInt(e.target.value) || 5432,
                    }))
                  }
                  placeholder="5432"
                  min="1"
                  max="65535"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Database *
                </label>
                <Input
                  value={formData.database}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      database: e.target.value,
                    }))
                  }
                  placeholder="postgres"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Username *
                </label>
                <Input
                  value={formData.username}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  placeholder="postgres"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Password *
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                    placeholder="••••••••"
                    required
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="ssl"
                  checked={formData.ssl}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, ssl: e.target.checked }))
                  }
                  className="mr-2 h-4 w-4 text-black border-black rounded"
                />
                <label htmlFor="ssl" className="text-sm text-black font-medium">
                  Use SSL
                </label>
              </div>

              {/* Test Connection */}
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="w-full mb-2">
                  <TestTube className="h-4 w-4 mr-2" />
                  {testingConnection ? "Testing..." : "Test Connection"}
                </Button>

                {testResult && (
                  <div
                    className={`text-sm p-2 rounded border ${testResult.success
                        ? "bg-white text-black border-black"
                        : "bg-white text-black border-black"
                      }`}>
                    {testResult.message}
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingConnection ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
