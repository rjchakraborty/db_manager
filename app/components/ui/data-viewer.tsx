"use client";

import React, { useState, useEffect, useRef } from "react";
import { Copy, Edit3, Save, X, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/utils";
import { DatabaseColumn } from "@/types/database";

interface DataViewerProps {
    isVisible: boolean;
    data: unknown;
    dataType: string;
    columnName: string;
    tableName?: string;
    // Editing props
    isEditable?: boolean;
    column?: DatabaseColumn;
    onSave?: (newValue: unknown) => Promise<void>;
    rowIndex?: number;
}

export default function DataViewer({
    isVisible,
    data,
    dataType,
    columnName,
    tableName,
    isEditable = false,
    column,
    onSave,
}: DataViewerProps) {
    const [formattedData, setFormattedData] = useState<string>("");
    const [editingValue, setEditingValue] = useState<string>("");
    const [isValidJson, setIsValidJson] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Determine data characteristics
    const isNumericType = column?.data_type.includes('int') ||
        column?.data_type.includes('numeric') ||
        column?.data_type.includes('decimal') ||
        column?.data_type.includes('float') ||
        column?.data_type.includes('double');

    const isBooleanType = column?.data_type === 'boolean';

    // Format data for display and editing
    useEffect(() => {
        try {
            if (data === null || data === undefined) {
                setFormattedData("NULL");
                setEditingValue("");
                setIsValidJson(false);
                return;
            }

            // Check if data is already an object (not a string)
            if (typeof data === 'object') {
                try {
                    const formatted = JSON.stringify(data, null, 2);
                    setFormattedData(formatted);
                    setEditingValue(formatted);
                    setIsValidJson(true);
                    return;
                } catch {
                    // If stringify fails, convert to string
                    const stringData = String(data);
                    setFormattedData(stringData);
                    setEditingValue(stringData);
                    setIsValidJson(false);
                    return;
                }
            }

            // Data is a string, check if it's JSON
            let stringData = String(data);

            // Try to parse as JSON for formatting
            try {
                const parsed = JSON.parse(stringData);
                const formatted = JSON.stringify(parsed, null, 2);
                setFormattedData(formatted);
                setEditingValue(formatted);
                setIsValidJson(true);
            } catch {
                // Not JSON, treat as plain text
                setFormattedData(stringData);
                setEditingValue(stringData);
                setIsValidJson(false);
            }
        } catch (err) {
            setFormattedData("");
            setEditingValue("");
            setIsValidJson(false);
        }
    }, [data]);

    // Validation function
    const validateValue = (value: string): string | null => {
        if (!column) return null;

        // Check if empty value is allowed
        if (value.trim() === "") {
            if (!column.is_nullable) {
                return "This field cannot be NULL";
            }
            return null; // Valid NULL
        }

        // Type-specific validation
        if (isNumericType) {
            if (isNaN(Number(value))) {
                return "Must be a valid number";
            }
        }

        if (isBooleanType) {
            const lowerValue = value.toLowerCase().trim();
            const validBooleans = ['true', 'false', '1', '0', 't', 'f'];
            if (!validBooleans.includes(lowerValue)) {
                return "Must be true, false, 1, 0, t, or f";
            }
        }

        if (isValidJson) {
            try {
                JSON.parse(value);
            } catch {
                return "Must be valid JSON format";
            }
        }

        // Check max length
        if (column.character_maximum_length && value.length > column.character_maximum_length) {
            return `Maximum length is ${column.character_maximum_length} characters`;
        }

        return null;
    };

    // Handle editing value changes
    const handleEditingValueChange = (newValue: string) => {
        setEditingValue(newValue);

        if (column) {
            const error = validateValue(newValue);
            setValidationError(error);
        }
    };

    // Copy to clipboard
    const handleCopy = async () => {
        const textToCopy = isEditing ? editingValue : formattedData;
        await copyToClipboard(textToCopy);
    };

    // Start editing
    const startEditing = () => {
        if (!isEditable) return;
        setIsEditing(true);

        // Focus the appropriate input
        setTimeout(() => {
            if (editingValue.length > 100 || editingValue.includes('\n') || isValidJson) {
                textareaRef.current?.focus();
            } else {
                inputRef.current?.focus();
            }
        }, 0);
    };

    // Cancel editing
    const cancelEditing = () => {
        setIsEditing(false);
        setEditingValue(formattedData);
        setValidationError(null);
    };

    // Save changes
    const handleSave = async () => {
        if (!onSave || validationError) return;

        try {
            setIsSaving(true);

            let valueToSave: unknown = editingValue.trim();

            // Handle NULL values
            if (valueToSave === "" && column?.is_nullable) {
                valueToSave = null;
            }
            // Handle boolean conversion
            else if (isBooleanType && typeof valueToSave === 'string') {
                const lowerValue = valueToSave.toLowerCase();
                if (['true', '1', 't'].includes(lowerValue)) {
                    valueToSave = true;
                } else if (['false', '0', 'f'].includes(lowerValue)) {
                    valueToSave = false;
                }
            }
            // Handle numeric conversion
            else if (isNumericType && typeof valueToSave === 'string') {
                valueToSave = Number(valueToSave);
            }
            // Handle JSON parsing
            else if (isValidJson && typeof valueToSave === 'string') {
                try {
                    valueToSave = JSON.parse(valueToSave);
                } catch {
                    // Keep as string if parsing fails
                }
            }

            await onSave(valueToSave);

            // Update display data
            setFormattedData(editingValue);
            setIsEditing(false);
            setValidationError(null);

        } catch (error) {
            console.error('Save error:', error);
            setValidationError(error instanceof Error ? error.message : 'Failed to save');
        } finally {
            setIsSaving(false);
        }
    };

    // Handle keyboard shortcuts
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEditing();
        }
    };

    if (!isVisible) {
        return null;
    }

    return (
        <div className="bg-white border-t border-gray-200 flex flex-col min-h-0">
            {/* Simple Header */}
            <div className="flex items-center justify-between p-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                <div className="flex items-center space-x-2 min-w-0">
                    <h4 className="text-sm font-medium text-gray-900 truncate">
                        {columnName}
                    </h4>
                    <span className="text-xs text-gray-500 truncate">
                        {isValidJson ? "JSON" : dataType}
                    </span>
                </div>
                <div className="flex items-center space-x-1 flex-shrink-0">
                    {isEditing ? (
                        <>
                            <Button
                                onClick={handleSave}
                                disabled={!!validationError || isSaving}
                                variant="outline"
                                size="sm">
                                {isSaving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </Button>
                            <Button onClick={cancelEditing} variant="outline" size="sm">
                                <X className="h-3 w-3" />
                            </Button>
                        </>
                    ) : (
                        <>
                            {isEditable && (
                                <Button onClick={startEditing} variant="outline" size="sm">
                                    <Edit3 className="h-3 w-3" />
                                </Button>
                            )}
                            <Button onClick={handleCopy} variant="outline" size="sm">
                                <Copy className="h-3 w-3" />
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Validation Error */}
            {validationError && (
                <div className="px-2 py-1 bg-red-50 border-b border-red-200 flex-shrink-0">
                    <div className="flex items-center">
                        <AlertCircle className="h-3 w-3 text-red-500 mr-1" />
                        <span className="text-xs text-red-700">{validationError}</span>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 min-h-0 p-2">
                {isEditing ? (
                    <div className="h-full flex flex-col">
                        {/* Editor Input */}
                        {editingValue.length > 100 || editingValue.includes('\n') || isValidJson ? (
                            <textarea
                                ref={textareaRef}
                                value={editingValue}
                                onChange={(e) => handleEditingValueChange(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full flex-1 text-xs font-mono resize-none border border-gray-300 rounded p-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 overflow-auto"
                                placeholder={column?.is_nullable ? "Enter value or leave empty for NULL" : "Enter value"}
                            />
                        ) : (
                            <input
                                ref={inputRef}
                                value={editingValue}
                                onChange={(e) => handleEditingValueChange(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full text-xs font-mono border border-gray-300 rounded p-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 overflow-x-auto"
                                placeholder={column?.is_nullable ? "Enter value or leave empty for NULL" : "Enter value"}
                            />
                        )}
                    </div>
                ) : (
                    <div className="h-full overflow-auto">
                        <pre className="text-xs font-mono whitespace-pre text-gray-800 leading-relaxed min-w-max">
                            {formattedData}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}