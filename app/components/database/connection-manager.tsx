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
  Wifi,
  WifiOff,
  Activity,
} from "lucide-react";
// Import types and constants locally to avoid client-side Node.js imports
interface TunnelStatus {
  id: string;
  isActive: boolean;
  localPort: number;
  pid?: number;
  error?: string;
  startedAt?: Date;
}

interface TunnelConfig {
  id: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sshHost: string;
  sshUser: string;
  privateKey: string;
  isActive: boolean;
}

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
    requiresTunnel: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [tunnelStatuses, setTunnelStatuses] = useState<
    Map<string, TunnelStatus>
  >(new Map());
  const [startingTunnel, setStartingTunnel] = useState<string | null>(null);
  const [tunnelConfig, setTunnelConfig] = useState<TunnelConfig | null>(null);
  const [showPassphraseDialog, setShowPassphraseDialog] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState("");

  // Load connections from secure storage
  useEffect(() => {
    loadConnections();
    loadTunnelStatuses();
    loadTunnelConfig();
  }, []);

  const loadTunnelConfig = async () => {
    try {
      const response = await fetch("/api/tunnel/config");
      const result = await response.json();
      if (result.success && result.config) {
        setTunnelConfig(result.config);
      }
    } catch (error) {
      console.error("Error loading tunnel config:", error);
    }
  };

  // Poll tunnel statuses periodically
  useEffect(() => {
    const interval = setInterval(loadTunnelStatuses, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadConnections = () => {
    try {
      const stored = secureStorage.get<DatabaseConnection[]>(
        CONNECTIONS_STORAGE_KEY
      );

      let currentConnections = stored || [];

      // Auto-add default RDS connection if it doesn't exist
      const hasRDSConnection = currentConnections.some(
        (conn) => conn.tunnelId === "default-rds-tunnel"
      );

      if (!hasRDSConnection) {
        const rdsConnection: DatabaseConnection = {
          id: generateId(),
          name: "PistonPay Production RDS",
          host: "localhost",
          port: 5432,
          database: "pistonpay_production",
          username: "piston_fleet_admin",
          password: "", // User will need to fill this
          ssl: false,
          requiresTunnel: true,
          tunnelId: "default-rds-tunnel",
          createdAt: new Date(),
        };

        currentConnections = [rdsConnection, ...currentConnections];
        secureStorage.set(CONNECTIONS_STORAGE_KEY, currentConnections);
      }

      setConnections(currentConnections);
    } catch (error) {
      console.error("Error loading connections:", error);
      // If there's an error loading (e.g., corrupted data), start fresh
      setConnections([]);
    }
  };

  const loadTunnelStatuses = async () => {
    try {
      const response = await fetch("/api/tunnel/status");
      const result = await response.json();
      if (result.success && result.statuses) {
        const statusMap = new Map<string, TunnelStatus>();
        result.statuses.forEach((status: TunnelStatus) => {
          statusMap.set(status.id, status);
        });
        setTunnelStatuses(statusMap);
      }
    } catch (error) {
      console.error("Error loading tunnel statuses:", error);
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

    const requiresTunnel = formData.requiresTunnel || false;

    const connectionData: DatabaseConnection = {
      id: editingConnection?.id || generateId(),
      name: formData.name!,
      host: formData.host!,
      port: formData.port || 5432,
      database: formData.database!,
      username: formData.username!,
      password: formData.password!,
      // Force SSL to true if tunnel is required (RDS requires SSL)
      ssl: requiresTunnel ? true : formData.ssl || false,
      requiresTunnel: requiresTunnel,
      tunnelId: requiresTunnel ? "default-rds-tunnel" : undefined,
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
      requiresTunnel: connection.requiresTunnel,
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
      requiresTunnel: false,
    });
    setShowPassword(false);
    setTestResult(null);
  };

  const handleStartTunnel = async (tunnelId: string) => {
    if (!tunnelConfig) {
      alert("Tunnel configuration not loaded");
      return;
    }

    setStartingTunnel(tunnelId);

    try {
      const configWithId = {
        ...tunnelConfig,
        id: tunnelId,
      };

      const response = await fetch("/api/tunnel/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configWithId),
      });

      const result = await response.json();
      if (result.success) {
        await loadTunnelStatuses();
        if (tunnelId === "default-rds-tunnel") {
          alert(
            "Tunnel started! Please enter your SSH passphrase in the terminal if prompted."
          );
        }
      } else {
        alert(`Failed to start tunnel: ${result.error}`);
      }
    } catch (error) {
      console.error("Error starting tunnel:", error);
      alert("Failed to start tunnel");
    } finally {
      setStartingTunnel(null);
    }
  };

  const handleRDSTunnelWithPassphrase = async () => {
    if (!passphrase.trim()) {
      setPassphraseError("Passphrase is required");
      return;
    }

    setStartingTunnel("default-rds-tunnel");
    setShowPassphraseDialog(false);
    setPassphraseError("");

    try {
      const response = await fetch("/api/tunnel/start-rds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      const result = await response.json();
      if (result.success) {
        await loadTunnelStatuses();
        alert(result.message || "RDS tunnel started successfully!");
      } else {
        alert(`Failed to start RDS tunnel: ${result.error}`);
      }
    } catch (error) {
      console.error("Error starting RDS tunnel:", error);
      alert("Failed to start RDS tunnel");
    } finally {
      setStartingTunnel(null);
      setPassphrase("");
    }
  };

  const handleStopTunnel = async (tunnelId: string) => {
    try {
      const response = await fetch("/api/tunnel/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tunnelId }),
      });

      const result = await response.json();
      if (result.success) {
        await loadTunnelStatuses();
      } else {
        alert(`Failed to stop tunnel: ${result.error}`);
      }
    } catch (error) {
      console.error("Error stopping tunnel:", error);
      alert("Failed to stop tunnel");
    }
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

    // Check if tunnel is required and active
    if (formData.requiresTunnel) {
      const tunnelStatus = tunnelStatuses.get("default-rds-tunnel");
      if (!tunnelStatus?.isActive) {
        setTestResult({
          success: false,
          message:
            "RDS tunnel is required but not active. Please start the tunnel first.",
        });
        return;
      }
    }

    setTestingConnection(true);
    setTestResult(null);

    try {
      const requiresTunnel = formData.requiresTunnel || false;

      const testConnection: DatabaseConnection = {
        id: "test",
        name: "Test Connection",
        host: requiresTunnel ? "localhost" : formData.host!.trim(), // Use localhost if tunnel is active
        port: formData.port || 5432,
        database: formData.database!.trim(),
        username: formData.username!.trim(),
        password: formData.password!,
        // Force SSL to true if tunnel is required (RDS requires SSL)
        ssl: requiresTunnel ? true : formData.ssl || false,
        requiresTunnel: requiresTunnel,
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
            className={`p-3 rounded border cursor-pointer transition-colors ${
              selectedConnectionId === connection.id
                ? "bg-gray-100 border-black"
                : "bg-white border-gray-300 hover:bg-gray-50"
            }`}
            onClick={() => {
              // Check if tunnel is required and active before allowing connection
              if (connection.requiresTunnel && connection.tunnelId) {
                const tunnelStatus = tunnelStatuses.get(connection.tunnelId);
                if (!tunnelStatus?.isActive) {
                  alert(
                    "Please start the RDS tunnel before connecting to this database."
                  );
                  return;
                }
              }
              onConnectionSelect(connection);
            }}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm truncate text-black">
                    {connection.name}
                  </h3>
                  {connection.requiresTunnel && (
                    <div className="flex items-center">
                      {connection.tunnelId &&
                      tunnelStatuses.get(connection.tunnelId)?.isActive ? (
                        <div title="Tunnel Active">
                          <Activity className="h-3 w-3 text-green-600" />
                        </div>
                      ) : (
                        <div title="Tunnel Inactive">
                          <WifiOff className="h-3 w-3 text-gray-400" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-600 truncate">
                  {connection.username}@{connection.host}:{connection.port}/
                  {connection.database}
                  {connection.requiresTunnel && " (via tunnel)"}
                </p>
                {connection.requiresTunnel && connection.tunnelId && (
                  <div className="flex items-center gap-1 mt-1">
                    {tunnelStatuses.get(connection.tunnelId)?.isActive ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStopTunnel(connection.tunnelId!);
                        }}
                        className="h-6 px-2 text-xs text-red-600 hover:text-red-700">
                        <WifiOff className="h-3 w-3 mr-1" />
                        Stop Tunnel
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartTunnel(connection.tunnelId!);
                        }}
                        disabled={startingTunnel === connection.tunnelId}
                        className="h-6 px-2 text-xs text-green-600 hover:text-green-700">
                        <Wifi className="h-3 w-3 mr-1" />
                        {startingTunnel === connection.tunnelId
                          ? "Starting..."
                          : "Start Tunnel"}
                      </Button>
                    )}
                  </div>
                )}
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

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="requiresTunnel"
                  checked={formData.requiresTunnel}
                  onChange={(e) => {
                    const requiresTunnel = e.target.checked;
                    // Automatically enable SSL when tunnel is enabled (RDS requires SSL)
                    setFormData((prev) => ({
                      ...prev,
                      requiresTunnel,
                      ssl: requiresTunnel ? true : prev.ssl, // Force SSL on if tunnel is enabled
                    }));
                  }}
                  className="mr-2 h-4 w-4 text-black border-black rounded"
                />
                <label
                  htmlFor="requiresTunnel"
                  className="text-sm text-black font-medium">
                  Requires RDS Tunnel
                </label>
              </div>

              {formData.requiresTunnel && (
                <div className="bg-gray-50 p-3 rounded border text-sm text-gray-700">
                  <div className="flex items-center gap-2 mb-2">
                    <Wifi className="h-4 w-4" />
                    <span className="font-medium">
                      RDS Tunnel Configuration
                    </span>
                  </div>
                  <p className="text-xs">
                    This connection will use the default RDS tunnel
                    configuration:
                  </p>
                  {tunnelConfig ? (
                    <ul className="text-xs mt-1 space-y-1">
                      <li>• Local Port: {tunnelConfig.localPort}</li>
                      <li>
                        • Remote: {tunnelConfig.remoteHost}:
                        {tunnelConfig.remotePort}
                      </li>
                      <li>
                        • SSH: {tunnelConfig.sshUser}@{tunnelConfig.sshHost}
                      </li>
                    </ul>
                  ) : (
                    <div className="text-xs mt-1 text-gray-500">
                      Loading configuration...
                    </div>
                  )}
                  <p className="text-xs mt-2 text-blue-600">
                    ℹ️ SSL is automatically enabled for tunnel connections
                    (required by RDS).
                  </p>
                  <p className="text-xs mt-1 text-amber-600">
                    Make sure to start the tunnel before connecting to the
                    database.
                  </p>
                </div>
              )}

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
                    className={`text-sm p-2 rounded border ${
                      testResult.success
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

      {/* RDS Tunnel Passphrase Dialog */}
      {showPassphraseDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-full max-w-md border border-black">
            <h3 className="text-lg font-semibold mb-4 text-black">
              Start Database Tunnel
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter the passphrase for your SSH key to establish the tunnel
              connection.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-black mb-2">
                SSH Key Passphrase
              </label>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setPassphraseError("");
                }}
                placeholder="Enter passphrase"
                className="w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleRDSTunnelWithPassphrase();
                  }
                }}
              />
              {passphraseError && (
                <p className="text-red-600 text-xs mt-1">{passphraseError}</p>
              )}
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowPassphraseDialog(false);
                  setPassphrase("");
                  setPassphraseError("");
                }}>
                Cancel
              </Button>
              <Button
                onClick={handleRDSTunnelWithPassphrase}
                disabled={
                  !passphrase.trim() || startingTunnel === "default-rds-tunnel"
                }>
                {startingTunnel === "default-rds-tunnel"
                  ? "Starting..."
                  : "Start Tunnel"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
