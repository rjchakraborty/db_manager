import { DatabaseTable, DatabaseColumn } from "@/types/database";

export interface SQLCompletionItem {
    label: string;
    kind: string;
    insertText: string;
    detail?: string;
    documentation?: string;
    sortText?: string;
}

export class SQLIntelligenceProvider {
    private tables: DatabaseTable[] = [];
    private currentSchema: string = "public";

    constructor(tables: DatabaseTable[] = [], currentSchema: string = "public") {
        this.tables = tables;
        this.currentSchema = currentSchema;
    }

    updateSchema(tables: DatabaseTable[], currentSchema: string = "public") {
        this.tables = tables;
        this.currentSchema = currentSchema;
    }

    // SQL Keywords and functions
    private readonly SQL_KEYWORDS = [
        // Basic SQL Commands
        "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "JOIN", "LEFT JOIN", "RIGHT JOIN",
        "INNER JOIN", "OUTER JOIN", "FULL JOIN", "CROSS JOIN", "UNION", "UNION ALL", "INTERSECT", "EXCEPT",

        // Clauses
        "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "DISTINCT", "ALL", "AS", "ON", "USING",

        // Conditions
        "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "IS", "IS NOT", "NULL", "NOT NULL",

        // Functions
        "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CASE", "WHEN", "THEN", "ELSE", "END",

        // Date/Time
        "NOW", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "EXTRACT", "DATE_TRUNC", "AGE",

        // String functions
        "CONCAT", "SUBSTRING", "LENGTH", "UPPER", "LOWER", "TRIM", "LTRIM", "RTRIM", "REPLACE",

        // DDL
        "CREATE", "DROP", "ALTER", "TABLE", "INDEX", "VIEW", "SCHEMA", "DATABASE", "CONSTRAINT",
        "PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK", "DEFAULT",

        // DML
        "INSERT INTO", "VALUES", "SET", "DELETE FROM", "UPDATE", "RETURNING",

        // Transaction
        "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE",

        // PostgreSQL specific
        "WITH", "RECURSIVE", "WINDOW", "OVER", "PARTITION BY", "ROWS", "RANGE", "PRECEDING", "FOLLOWING",
        "UNBOUNDED", "CURRENT ROW"
    ];

    private readonly SQL_FUNCTIONS = [
        // Aggregate functions
        { name: "COUNT(*)", detail: "Count all rows", insertText: "COUNT(*)" },
        { name: "COUNT(column)", detail: "Count non-null values", insertText: "COUNT(${1:column})" },
        { name: "SUM(column)", detail: "Sum of values", insertText: "SUM(${1:column})" },
        { name: "AVG(column)", detail: "Average of values", insertText: "AVG(${1:column})" },
        { name: "MIN(column)", detail: "Minimum value", insertText: "MIN(${1:column})" },
        { name: "MAX(column)", detail: "Maximum value", insertText: "MAX(${1:column})" },

        // String functions
        { name: "CONCAT()", detail: "Concatenate strings", insertText: "CONCAT(${1:str1}, ${2:str2})" },
        { name: "SUBSTRING()", detail: "Extract substring", insertText: "SUBSTRING(${1:string} FROM ${2:start} FOR ${3:length})" },
        { name: "LENGTH()", detail: "String length", insertText: "LENGTH(${1:string})" },
        { name: "UPPER()", detail: "Convert to uppercase", insertText: "UPPER(${1:string})" },
        { name: "LOWER()", detail: "Convert to lowercase", insertText: "LOWER(${1:string})" },

        // Date functions
        { name: "NOW()", detail: "Current timestamp", insertText: "NOW()" },
        { name: "CURRENT_DATE", detail: "Current date", insertText: "CURRENT_DATE" },
        { name: "EXTRACT()", detail: "Extract date part", insertText: "EXTRACT(${1:field} FROM ${2:date})" },
        { name: "DATE_TRUNC()", detail: "Truncate date", insertText: "DATE_TRUNC('${1:field}', ${2:date})" },

        // Conditional
        { name: "CASE WHEN", detail: "Conditional expression", insertText: "CASE WHEN ${1:condition} THEN ${2:result} ELSE ${3:default} END" },
        { name: "COALESCE()", detail: "Return first non-null", insertText: "COALESCE(${1:value1}, ${2:value2})" },
        { name: "NULLIF()", detail: "Return null if equal", insertText: "NULLIF(${1:value1}, ${2:value2})" }
    ];

    private readonly QUERY_TEMPLATES = [
        {
            name: "SELECT basic",
            detail: "Basic SELECT query",
            insertText: "SELECT ${1:columns}\nFROM ${2:table}\nWHERE ${3:condition};"
        },
        {
            name: "SELECT with JOIN",
            detail: "SELECT with table join",
            insertText: "SELECT ${1:t1.column}, ${2:t2.column}\nFROM ${3:table1} t1\nJOIN ${4:table2} t2 ON t1.${5:id} = t2.${6:foreign_id}\nWHERE ${7:condition};"
        },
        {
            name: "INSERT INTO",
            detail: "Insert new record",
            insertText: "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});"
        },
        {
            name: "UPDATE SET",
            detail: "Update existing records",
            insertText: "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};"
        },
        {
            name: "DELETE FROM",
            detail: "Delete records",
            insertText: "DELETE FROM ${1:table}\nWHERE ${2:condition};"
        },
        {
            name: "CREATE TABLE",
            detail: "Create new table",
            insertText: "CREATE TABLE ${1:table_name} (\n    ${2:column_name} ${3:data_type} ${4:constraints}\n);"
        }
    ];

    // Get completions based on current context
    getCompletions(model: any, position: any): SQLCompletionItem[] {
        const textUntilPosition = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        });

        const currentLine = model.getLineContent(position.lineNumber);
        const wordInfo = model.getWordUntilPosition(position);
        const word = wordInfo.word.toUpperCase();

        const completions: SQLCompletionItem[] = [];

        // Add SQL keywords
        this.SQL_KEYWORDS.forEach((keyword, index) => {
            if (keyword.includes(word) || word === "") {
                completions.push({
                    label: keyword,
                    kind: "Keyword",
                    insertText: keyword,
                    detail: "SQL Keyword",
                    sortText: `0${index.toString().padStart(3, '0')}`
                });
            }
        });

        // Add SQL functions
        this.SQL_FUNCTIONS.forEach((func, index) => {
            if (func.name.toUpperCase().includes(word) || word === "") {
                completions.push({
                    label: func.name,
                    kind: "Function",
                    insertText: func.insertText,
                    detail: func.detail,
                    sortText: `1${index.toString().padStart(3, '0')}`
                });
            }
        });

        // Add query templates
        if (word === "" || textUntilPosition.trim() === "") {
            this.QUERY_TEMPLATES.forEach((template, index) => {
                completions.push({
                    label: template.name,
                    kind: "Snippet",
                    insertText: template.insertText,
                    detail: template.detail,
                    documentation: "SQL Query Template",
                    sortText: `2${index.toString().padStart(3, '0')}`
                });
            });
        }

        // Add table names
        this.getTableCompletions(word).forEach((completion, index) => {
            completions.push({
                ...completion,
                sortText: `3${index.toString().padStart(3, '0')}`
            });
        });

        // Add column names (context-aware)
        this.getColumnCompletions(textUntilPosition, word).forEach((completion, index) => {
            completions.push({
                ...completion,
                sortText: `4${index.toString().padStart(3, '0')}`
            });
        });

        return completions;
    }

    private getTableCompletions(word: string): SQLCompletionItem[] {
        const completions: SQLCompletionItem[] = [];

        this.tables.forEach(table => {
            if (table.table_name.toUpperCase().includes(word) || word === "") {
                const schemaPrefix = table.table_schema !== this.currentSchema ? `${table.table_schema}.` : "";
                const fullTableName = `${schemaPrefix}${table.table_name}`;

                completions.push({
                    label: fullTableName,
                    kind: "Class",
                    insertText: fullTableName,
                    detail: `Table (${table.columns.length} columns)`,
                    documentation: `Schema: ${table.table_schema}\nColumns: ${table.columns.map(c => c.column_name).join(", ")}`
                });
            }
        });

        return completions;
    }

    private getColumnCompletions(textUntilPosition: string, word: string): SQLCompletionItem[] {
        const completions: SQLCompletionItem[] = [];

        // Try to determine context (which table we're working with)
        const contextTable = this.inferTableContext(textUntilPosition);

        if (contextTable) {
            // Add columns from the inferred table
            contextTable.columns.forEach(column => {
                if (column.column_name.toUpperCase().includes(word) || word === "") {
                    completions.push({
                        label: column.column_name,
                        kind: "Field",
                        insertText: column.column_name,
                        detail: `${column.data_type}${column.is_nullable ? " (nullable)" : " (not null)"}`,
                        documentation: this.getColumnDocumentation(column)
                    });
                }
            });
        } else {
            // Add all columns from all tables with table prefix
            this.tables.forEach(table => {
                table.columns.forEach(column => {
                    if (column.column_name.toUpperCase().includes(word) || word === "") {
                        completions.push({
                            label: `${table.table_name}.${column.column_name}`,
                            kind: "Field",
                            insertText: `${table.table_name}.${column.column_name}`,
                            detail: `${column.data_type} from ${table.table_name}`,
                            documentation: this.getColumnDocumentation(column)
                        });
                    }
                });
            });
        }

        return completions;
    }

    private inferTableContext(textUntilPosition: string): DatabaseTable | null {
        const text = textUntilPosition.toUpperCase();

        // Look for FROM clause
        const fromMatch = text.match(/FROM\s+(\w+)/);
        if (fromMatch) {
            const tableName = fromMatch[1].toLowerCase();
            return this.tables.find(t => t.table_name === tableName) || null;
        }

        // Look for UPDATE clause
        const updateMatch = text.match(/UPDATE\s+(\w+)/);
        if (updateMatch) {
            const tableName = updateMatch[1].toLowerCase();
            return this.tables.find(t => t.table_name === tableName) || null;
        }

        // Look for INSERT INTO clause
        const insertMatch = text.match(/INSERT\s+INTO\s+(\w+)/);
        if (insertMatch) {
            const tableName = insertMatch[1].toLowerCase();
            return this.tables.find(t => t.table_name === tableName) || null;
        }

        return null;
    }

    private getColumnDocumentation(column: DatabaseColumn): string {
        const parts = [
            `Type: ${column.data_type}`,
            `Position: ${column.ordinal_position}`,
            column.is_nullable ? "Nullable: Yes" : "Nullable: No"
        ];

        if (column.column_default) {
            parts.push(`Default: ${column.column_default}`);
        }

        if (column.character_maximum_length) {
            parts.push(`Max Length: ${column.character_maximum_length}`);
        }

        if (column.is_primary_key) {
            parts.push("🔑 Primary Key");
        }

        if (column.is_foreign_key && column.foreign_key_table) {
            parts.push(`🔗 Foreign Key → ${column.foreign_key_table}.${column.foreign_key_column}`);
        }

        return parts.join("\n");
    }

    // Get hover information for SQL elements
    getHoverInfo(model: any, position: any): string | null {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const wordText = word.word.toLowerCase();

        // Check if it's a table name
        const table = this.tables.find(t => t.table_name === wordText);
        if (table) {
            return `**Table: ${table.table_name}**\n\nSchema: ${table.table_schema}\nColumns: ${table.columns.length}\n\n**Columns:**\n${table.columns.map(c => `• ${c.column_name} (${c.data_type})`).join('\n')}`;
        }

        // Check if it's a column name
        for (const table of this.tables) {
            const column = table.columns.find(c => c.column_name === wordText);
            if (column) {
                return `**Column: ${column.column_name}**\n\nTable: ${table.table_name}\n${this.getColumnDocumentation(column)}`;
            }
        }

        return null;
    }
}

// Rate limiting for AI calls
export class AIRateLimiter {
    private calls: number[] = [];
    private readonly maxCalls: number;
    private readonly timeWindow: number; // in milliseconds

    constructor(maxCalls: number = 10, timeWindowMinutes: number = 1) {
        this.maxCalls = maxCalls;
        this.timeWindow = timeWindowMinutes * 60 * 1000;
    }

    canMakeCall(): boolean {
        const now = Date.now();
        // Remove calls outside the time window
        this.calls = this.calls.filter(callTime => now - callTime < this.timeWindow);

        return this.calls.length < this.maxCalls;
    }

    recordCall(): void {
        this.calls.push(Date.now());
    }

    getTimeUntilNextCall(): number {
        if (this.canMakeCall()) return 0;

        const oldestCall = Math.min(...this.calls);
        return this.timeWindow - (Date.now() - oldestCall);
    }

    getRemainingCalls(): number {
        const now = Date.now();
        this.calls = this.calls.filter(callTime => now - callTime < this.timeWindow);
        return Math.max(0, this.maxCalls - this.calls.length);
    }
}
