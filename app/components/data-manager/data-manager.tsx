"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { robustStorage } from "@/lib/persistent-storage";
import { DataMigrationManager } from "@/lib/data-migration";
import {
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  FileText,
  Database,
  Settings,
  History,
} from "lucide-react";

interface DataManagerProps {
  onClose?: () => void;
}

export default function DataManager({ onClose }: DataManagerProps) {
  const [migrationStatus, setMigrationStatus] = useState<{
    needsMigration: boolean;
    hasOldData: boolean;
    recommendations: string[];
  } | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    success: boolean;
    recovered: string[];
    failed: string[];
    details: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [integrityCheck, setIntegrityCheck] = useState<{
    healthy: boolean;
    issues: string[];
  } | null>(null);
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [importStatus, setImportStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkMigrationStatus = async () => {
    setIsLoading(true);
    try {
      const status = DataMigrationManager.getMigrationStatus();
      setMigrationStatus(status);
    } catch (error) {
      console.error("Error checking migration status:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const performMigration = async () => {
    setIsLoading(true);
    setMigrationResult(null);
    try {
      const result = await DataMigrationManager.performMigration();
      setMigrationResult(result);

      // Refresh migration status after migration
      await checkMigrationStatus();
    } catch (error) {
      console.error("Migration error:", error);
      setMigrationResult({
        success: false,
        recovered: [],
        failed: [],
        details: `Migration failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const performIntegrityCheck = () => {
    setIsLoading(true);
    try {
      const result = robustStorage.checkDataIntegrity();
      setIntegrityCheck(result);
    } catch (error) {
      console.error("Integrity check error:", error);
      setIntegrityCheck({
        healthy: false,
        issues: [
          `Integrity check failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const exportData = () => {
    try {
      const exportedData = robustStorage.exportData();
      if (!exportedData) {
        setBackupStatus("❌ Export failed - no data available");
        return;
      }

      // Create download link
      const blob = new Blob([exportedData], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `db-manager-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupStatus("✅ Data exported successfully");
    } catch (error) {
      console.error("Export error:", error);
      setBackupStatus(
        `❌ Export failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const importData = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonData = e.target?.result as string;
        const result = robustStorage.importData(jsonData);

        if (result.success) {
          setImportStatus(`✅ ${result.message}`);
          // Refresh status after import
          setTimeout(() => {
            checkMigrationStatus();
            performIntegrityCheck();
          }, 1000);
        } else {
          setImportStatus(`❌ Import failed: ${result.message}`);
        }
      } catch (error) {
        setImportStatus(
          `❌ Import failed: ${
            error instanceof Error ? error.message : "Invalid file format"
          }`
        );
      }
    };

    reader.readAsText(file);
    // Clear the input
    event.target.value = "";
  };

  const emergencyRecovery = async () => {
    setIsLoading(true);
    try {
      const result = DataMigrationManager.emergencyDataRecovery();
      if (result.success) {
        setMigrationResult({
          success: true,
          recovered: Object.keys(result.recovered),
          failed: result.errors,
          details: `Emergency recovery found ${
            Object.keys(result.recovered).length
          } data items`,
        });
      } else {
        setMigrationResult({
          success: false,
          recovered: [],
          failed: result.errors,
          details: "Emergency recovery found no recoverable data",
        });
      }
    } catch (error) {
      setMigrationResult({
        success: false,
        recovered: [],
        failed: [],
        details: `Emergency recovery failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    // Load initial status
    checkMigrationStatus();
    performIntegrityCheck();
  }, []);

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Database className="h-5 w-5" />
          Data Management
        </h2>
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            ×
          </Button>
        )}
      </div>

      {/* Migration Status */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Migration Status
        </h3>

        {migrationStatus ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {migrationStatus.needsMigration ? (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
              <span>
                {migrationStatus.needsMigration
                  ? "Migration needed"
                  : "No migration required"}
              </span>
            </div>

            <div className="text-sm space-y-1">
              {migrationStatus.recommendations.map((rec, index) => (
                <div key={index} className="text-gray-600">
                  {rec}
                </div>
              ))}
            </div>

            {migrationStatus.needsMigration && (
              <Button
                onClick={performMigration}
                disabled={isLoading}
                size="sm"
                className="mt-2">
                {isLoading ? "Migrating..." : "Perform Migration"}
              </Button>
            )}
          </div>
        ) : (
          <Button onClick={checkMigrationStatus} size="sm" disabled={isLoading}>
            {isLoading ? "Checking..." : "Check Status"}
          </Button>
        )}

        {migrationResult && (
          <div
            className={`p-3 rounded border-l-4 ${
              migrationResult.success
                ? "border-green-500 bg-green-50"
                : "border-red-500 bg-red-50"
            }`}>
            <div className="font-medium">
              {migrationResult.success
                ? "✅ Migration Successful"
                : "❌ Migration Failed"}
            </div>
            {migrationResult.recovered.length > 0 && (
              <div className="text-sm mt-1">
                Recovered: {migrationResult.recovered.join(", ")}
              </div>
            )}
            {migrationResult.failed.length > 0 && (
              <div className="text-sm mt-1 text-red-600">
                Failed: {migrationResult.failed.join(", ")}
              </div>
            )}
            <div className="text-xs mt-1 text-gray-600 whitespace-pre-wrap">
              {migrationResult.details}
            </div>
          </div>
        )}
      </div>

      {/* Data Integrity */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Data Integrity
        </h3>

        {integrityCheck ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {integrityCheck.healthy ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-red-500" />
              )}
              <span>
                {integrityCheck.healthy
                  ? "Data integrity OK"
                  : "Issues detected"}
              </span>
            </div>

            {integrityCheck.issues.length > 0 && (
              <div className="text-sm space-y-1">
                {integrityCheck.issues.map((issue, index) => (
                  <div key={index} className="text-red-600">
                    • {issue}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <Button onClick={performIntegrityCheck} size="sm" disabled={isLoading}>
          {isLoading ? "Checking..." : "Check Integrity"}
        </Button>
      </div>

      {/* Backup & Restore */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Backup & Restore
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <Button onClick={exportData} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export Data
          </Button>

          <Button onClick={importData} variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-1" />
            Import Data
          </Button>
        </div>

        {backupStatus && (
          <div className="text-sm p-2 bg-gray-50 rounded">{backupStatus}</div>
        )}

        {importStatus && (
          <div className="text-sm p-2 bg-gray-50 rounded">{importStatus}</div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileImport}
          className="hidden"
        />
      </div>

      {/* Emergency Recovery */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2 text-orange-600">
          <AlertTriangle className="h-4 w-4" />
          Emergency Recovery
        </h3>

        <p className="text-sm text-gray-600">
          Use this if migration fails and you need to recover any accessible
          data from localStorage.
        </p>

        <Button
          onClick={emergencyRecovery}
          variant="outline"
          size="sm"
          disabled={isLoading}
          className="border-orange-500 text-orange-600 hover:bg-orange-50">
          {isLoading ? "Recovering..." : "Emergency Recovery"}
        </Button>
      </div>

      {/* Usage Tips */}
      <div className="border rounded-lg p-4 space-y-3 bg-blue-50">
        <h3 className="font-medium flex items-center gap-2 text-blue-700">
          <History className="h-4 w-4" />
          Tips
        </h3>

        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Export your data regularly to prevent loss</li>
          <li>• Run integrity checks if you experience issues</li>
          <li>• Migration is automatically attempted on app start</li>
          <li>• Emergency recovery can help if other methods fail</li>
        </ul>
      </div>
    </div>
  );
}
