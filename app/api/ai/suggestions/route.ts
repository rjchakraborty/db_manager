import { NextRequest, NextResponse } from "next/server";
import { convertNaturalLanguageToSQL, initializeGemini } from "@/lib/gemini";

// In-memory cache for AI suggestions (with TTL)
const suggestionCache = new Map<string, { suggestions: string[], timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Rate limiting per connection
const rateLimits = new Map<string, { count: number, resetTime: number }>();
const MAX_REQUESTS_PER_HOUR = 10;

export async function POST(request: NextRequest) {
    try {
        const { connectionId, fullSchema, apiKey, selectedTable } = await request.json();

        if (!connectionId || !fullSchema || !Array.isArray(fullSchema)) {
            return NextResponse.json(
                { error: "Connection ID and full schema are required" },
                { status: 400 }
            );
        }

        // Check rate limiting first
        const now = Date.now();
        const rateLimit = rateLimits.get(connectionId);

        if (rateLimit) {
            if (now < rateLimit.resetTime) {
                if (rateLimit.count >= MAX_REQUESTS_PER_HOUR) {
                    return NextResponse.json(
                        { error: "Rate limit exceeded. Please try again later." },
                        { status: 429 }
                    );
                }
            } else {
                // Reset the rate limit
                rateLimits.set(connectionId, { count: 0, resetTime: now + 60 * 60 * 1000 });
            }
        } else {
            rateLimits.set(connectionId, { count: 0, resetTime: now + 60 * 60 * 1000 });
        }

        // Create cache key based on schema structure and selected table
        const tableNames = fullSchema.flatMap((s: { schema_name: string; tables: Array<{ table_name: string }> }) =>
            s.tables.map((t: { table_name: string }) => `${s.schema_name}.${t.table_name}`)).sort();
        const cacheKey = `${connectionId}-${tableNames.join(',')}-${selectedTable?.schema || ''}.${selectedTable?.table || ''}`;

        // Check cache first
        const cached = suggestionCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < CACHE_TTL) {
            return NextResponse.json({ suggestions: cached.suggestions });
        }

        // If no API key, return smart fallback suggestions immediately
        if (!apiKey) {
            const fallbackSuggestions = generateFallbackSuggestions(fullSchema, selectedTable);
            suggestionCache.set(cacheKey, { suggestions: fallbackSuggestions, timestamp: now });
            return NextResponse.json({ suggestions: fallbackSuggestions });
        }

        // Record the API call for rate limiting
        const currentRateLimit = rateLimits.get(connectionId)!;
        rateLimits.set(connectionId, { ...currentRateLimit, count: currentRateLimit.count + 1 });

        // Build simplified context (only table names and key columns)
        interface Column {
            column_name: string;
            is_primary_key: boolean;
        }

        interface Table {
            table_name: string;
            columns: Column[];
        }

        interface Schema {
            schema_name: string;
            tables: Table[];
        }

        const simplifiedTables = fullSchema.flatMap((schema: Schema) =>
            schema.tables.map((table: Table) => ({
                name: `${schema.schema_name}.${table.table_name}`,
                keyColumns: table.columns
                    .filter((col: Column) => col.is_primary_key || col.column_name.includes('id') || col.column_name.includes('name') || col.column_name.includes('date'))
                    .slice(0, 3)
                    .map((col: Column) => col.column_name)
            }))
        ).slice(0, 5); // Limit to 5 tables max

        // Create a much simpler prompt
        const focusTable = selectedTable ? `${selectedTable.schema}.${selectedTable.table}` : simplifiedTables[0]?.name;
        const suggestionPrompt = `Generate 8 short query suggestions for database with tables: ${simplifiedTables.map(t => t.name).join(', ')}.
Focus on: ${focusTable}
Return JSON array only: ["suggestion1", "suggestion2", ...]`;

        // Initialize Gemini with the API key first
        initializeGemini(apiKey);

        // Use the existing Gemini function with simplified context
        const response = await convertNaturalLanguageToSQL({
            naturalLanguage: suggestionPrompt,
            context: {
                tables: simplifiedTables,
                currentSchema: "public",
                availableTables: simplifiedTables.map(t => t.name),
                tableNames: simplifiedTables.map(t => t.name.split('.')[1])
            }
        });

        // Parse the AI response to extract suggestions
        let suggestions: string[] = [];
        try {
            // Try to parse as JSON array first
            const parsed = JSON.parse(response.sql);
            if (Array.isArray(parsed)) {
                suggestions = parsed.slice(0, 8);
            } else {
                throw new Error("Not an array");
            }
        } catch {
            // Fallback: extract suggestions from text response
            const lines = response.sql.split('\n').filter(line => line.trim());
            suggestions = lines
                .map(line => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').replace(/^"/, '').replace(/"$/, '').trim())
                .filter(line => line.length > 10 && line.length < 80)
                .slice(0, 8);
        }

        // Use fallback if AI fails
        if (suggestions.length === 0) {
            suggestions = generateFallbackSuggestions(fullSchema, selectedTable);
        }

        // Cache the results
        suggestionCache.set(cacheKey, { suggestions, timestamp: now });

        return NextResponse.json({ suggestions });

    } catch (error: unknown) {
        console.error("Error generating suggestions:", error);

        // Return basic fallback suggestions on error
        return NextResponse.json({
            suggestions: [
                "Show all records from first table",
                "Count total records in database",
                "List all table names",
                "Show recent entries",
                "Find unique values",
                "Analyze data distribution",
                "Show table relationships",
                "Display column information"
            ]
        });
    }
}

// Generate intelligent fallback suggestions without AI
interface FallbackColumn {
    column_name: string;
    data_type: string;
}

interface FallbackTable {
    table_name: string;
    columns: FallbackColumn[];
}

interface FallbackSchema {
    schema_name: string;
    tables: FallbackTable[];
}

function generateFallbackSuggestions(fullSchema: FallbackSchema[], selectedTable?: { schema: string; table: string }): string[] {
    const allTables = fullSchema.flatMap((schema: FallbackSchema) =>
        schema.tables.map((table: FallbackTable) => ({
            name: table.table_name,
            schema: schema.schema_name,
            fullName: `${schema.schema_name}.${table.table_name}`,
            columns: table.columns || [],
            rowCount: (table as FallbackTable & { row_count?: number }).row_count
        }))
    );

    if (allTables.length === 0) {
        return ["Show all tables in database", "List database schemas"];
    }

    const focusTable = selectedTable ?
        allTables.find(t => t.name === selectedTable.table && t.schema === selectedTable.schema) :
        allTables[0];

    const suggestions: string[] = [];

    if (focusTable) {
        // Table-specific suggestions
        suggestions.push(`Show all records from ${focusTable.name}`);
        suggestions.push(`Count total records in ${focusTable.name}`);

        // Column-based suggestions
        const dateColumns = focusTable.columns.filter((col: FallbackColumn) =>
            col.data_type.includes('timestamp') || col.data_type.includes('date') ||
            col.column_name.includes('date') || col.column_name.includes('created') || col.column_name.includes('updated')
        );

        const nameColumns = focusTable.columns.filter((col: FallbackColumn) =>
            col.column_name.includes('name') || col.column_name.includes('title') || col.column_name.includes('description')
        );

        const idColumns = focusTable.columns.filter((col: FallbackColumn & { is_primary_key?: boolean }) =>
            col.column_name.includes('id') && !col.is_primary_key
        );

        if (dateColumns.length > 0) {
            suggestions.push(`Show recent entries from ${focusTable.name} ordered by ${dateColumns[0].column_name}`);
            suggestions.push(`Count records by date from ${focusTable.name}`);
        }

        if (nameColumns.length > 0) {
            suggestions.push(`Find unique ${nameColumns[0].column_name} values in ${focusTable.name}`);
            suggestions.push(`Search ${focusTable.name} by ${nameColumns[0].column_name}`);
        }

        if (idColumns.length > 0) {
            suggestions.push(`Find specific record in ${focusTable.name} by ${idColumns[0].column_name}`);
        }
    }

    // General database suggestions
    if (allTables.length > 1) {
        const secondTable = allTables[1];
        suggestions.push(`Show first 10 rows from ${secondTable.name}`);
        suggestions.push(`Compare record counts between ${focusTable?.name || allTables[0].name} and ${secondTable.name}`);
    }

    // Add more general suggestions to reach 8
    while (suggestions.length < 8) {
        const randomTable = allTables[Math.floor(Math.random() * allTables.length)];
        const newSuggestion = `Analyze data distribution in ${randomTable.name}`;
        if (!suggestions.includes(newSuggestion)) {
            suggestions.push(newSuggestion);
        }
    }

    return suggestions.slice(0, 8);
}
