import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  AIQueryRequest,
  AIQueryResponse,
  DatabaseTable,
  DatabaseColumn,
} from "@/types/database";

let genAI: GoogleGenerativeAI | null = null;

export const initializeGemini = (apiKey: string): void => {
  if (!apiKey) {
    throw new Error("Gemini API key is required");
  }
  genAI = new GoogleGenerativeAI(apiKey);
};

export const isGeminiInitialized = (): boolean => {
  return genAI !== null;
};

const generateDatabaseContext = (context: {
  tables: DatabaseTable[] | Record<string, unknown>[];
}): string => {
  if (!context || !context.tables || context.tables.length === 0) {
    return "No table information available.";
  }

  // Handle both old format (DatabaseTable[]) and new enhanced format
  const tables = context.tables;

  return tables
    .map((table: DatabaseTable | Record<string, unknown>) => {
      // Handle enhanced table format from EnhancedAIAssistant
      if ("name" in table && "columns" in table) {
        const columns = (
          table as { columns: Record<string, unknown>[] }
        ).columns
          .map((col: Record<string, unknown>) => {
            let colInfo = `${col.name} (${col.type}`;
            if (col.primaryKey) colInfo += ", PRIMARY KEY";
            if (col.foreignKey) colInfo += ", FOREIGN KEY";
            if (!col.nullable) colInfo += ", NOT NULL";
            colInfo += ")";
            return colInfo;
          })
          .join(", ");

        let tableInfo = `Table: ${
          table.fullTableName || table.schema + '."' + table.name + '"'
        }\nColumns: ${columns}`;
        if (table.columnList) {
          tableInfo += `\nAvailable column names: ${table.columnList}`;
        }
        if (table.rowCount) {
          tableInfo += `\nRow count: ${table.rowCount}`;
        }
        return tableInfo;
      }

      // Handle old format (DatabaseTable)
      const columns = (table as DatabaseTable).columns
        .map((col) => {
          let colInfo = `${col.column_name} (${col.data_type}`;
          if (col.is_primary_key) colInfo += ", PRIMARY KEY";
          if (col.is_foreign_key)
            colInfo += `, REFERENCES ${col.foreign_key_table}(${col.foreign_key_column})`;
          if (!col.is_nullable) colInfo += ", NOT NULL";
          colInfo += ")";
          return colInfo;
        })
        .join(", ");

      return `Table: ${table.table_schema}.${table.table_name}\nColumns: ${columns}`;
    })
    .join("\n\n");
};

// Helper function to build column hints for semantic matching
const buildColumnHints = (context: {
  tables: DatabaseTable[] | Record<string, unknown>[];
}): string => {
  if (!context || !context.tables || context.tables.length === 0) {
    return "";
  }

  const tables = context.tables;
  const columnsByType: Record<string, string[]> = {
    timestamp: [],
    date: [],
    time: [],
    id: [],
    name: [],
    email: [],
    status: [],
    count: [],
    amount: [],
    boolean: [],
  };

  tables.forEach((table: DatabaseTable | Record<string, unknown>) => {
    let columns: (DatabaseColumn | Record<string, unknown>)[] = [];
    let tableName = "";

    if ("name" in table && "columns" in table) {
      columns = (table as { columns: Record<string, unknown>[] }).columns;
      tableName =
        (table.fullTableName as string) || `${table.schema}."${table.name}"`;
    } else {
      columns = (table as DatabaseTable).columns;
      tableName = `${(table as DatabaseTable).table_schema}.${
        (table as DatabaseTable).table_name
      }`;
    }

    columns.forEach((col) => {
      const colName =
        "column_name" in col
          ? (col.column_name as string)
          : ((col as Record<string, unknown>).name as string);
      const colType =
        "data_type" in col
          ? (col.data_type as string).toLowerCase()
          : ((col as Record<string, unknown>).type as string).toLowerCase();
      const colNameLower = colName.toLowerCase();
      const fullColRef = `${tableName}.${colName}`;

      // Timestamp/Date columns
      if (
        colType.includes("timestamp") ||
        colType.includes("date") ||
        colType.includes("time")
      ) {
        if (
          colNameLower.includes("created") ||
          colNameLower === "createdat" ||
          colNameLower === "created_at"
        ) {
          columnsByType.timestamp.unshift(fullColRef + " [created timestamp]");
        } else if (
          colNameLower.includes("updated") ||
          colNameLower === "updatedat" ||
          colNameLower === "updated_at"
        ) {
          columnsByType.timestamp.push(fullColRef + " [updated timestamp]");
        } else if (
          colNameLower.includes("date") ||
          colNameLower.includes("time")
        ) {
          columnsByType.date.push(fullColRef);
        } else {
          columnsByType.timestamp.push(fullColRef);
        }
      }

      // ID columns
      if (colNameLower.includes("id") || colNameLower === "id") {
        columnsByType.id.push(fullColRef);
      }

      // Name columns
      if (
        colNameLower.includes("name") ||
        colNameLower.includes("title") ||
        colNameLower.includes("label")
      ) {
        columnsByType.name.push(fullColRef);
      }

      // Email columns
      if (colNameLower.includes("email") || colNameLower.includes("mail")) {
        columnsByType.email.push(fullColRef);
      }

      // Status columns
      if (colNameLower.includes("status") || colNameLower.includes("state")) {
        columnsByType.status.push(fullColRef);
      }

      // Count/Amount columns
      if (
        colNameLower.includes("count") ||
        colNameLower.includes("amount") ||
        colNameLower.includes("quantity") ||
        colNameLower.includes("total")
      ) {
        columnsByType.count.push(fullColRef);
      }

      // Boolean columns
      if (
        colType.includes("bool") ||
        colNameLower.startsWith("is_") ||
        colNameLower.startsWith("has_")
      ) {
        columnsByType.boolean.push(fullColRef);
      }
    });
  });

  // Build hints string
  let hints = "\n📋 COLUMN HINTS FOR SMART MATCHING:\n";
  hints += "Use these when user mentions vague or misspelled column names:\n\n";

  if (columnsByType.timestamp.length > 0) {
    hints += `⏰ Timestamp/Date columns: ${columnsByType.timestamp
      .slice(0, 5)
      .join(", ")}\n`;
    hints += `   Use for: "date", "time", "when", "created", "updated", "yesterday", "today", "recent"\n\n`;
  }

  if (columnsByType.id.length > 0) {
    hints += `🔑 ID columns: ${columnsByType.id.slice(0, 5).join(", ")}\n`;
    hints += `   Use for: "id", "identifier", "key"\n\n`;
  }

  if (columnsByType.name.length > 0) {
    hints += `📝 Name/Title columns: ${columnsByType.name
      .slice(0, 5)
      .join(", ")}\n`;
    hints += `   Use for: "name", "title", "label", "called"\n\n`;
  }

  if (columnsByType.status.length > 0) {
    hints += `📊 Status columns: ${columnsByType.status
      .slice(0, 5)
      .join(", ")}\n`;
    hints += `   Use for: "status", "state", "condition"\n\n`;
  }

  if (columnsByType.count.length > 0) {
    hints += `🔢 Count/Amount columns: ${columnsByType.count
      .slice(0, 5)
      .join(", ")}\n`;
    hints += `   Use for: "count", "amount", "total", "quantity", "number of"\n\n`;
  }

  return hints;
};

export const convertNaturalLanguageToSQL = async (
  request: AIQueryRequest
): Promise<AIQueryResponse> => {
  if (!genAI) {
    throw new Error("Gemini is not initialized. Please provide an API key.");
  }

  try {
    // Use gemini-2.5-pro for more accurate PostgreSQL query generation
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    const databaseContext = request.context
      ? generateDatabaseContext(request.context)
      : "";
    const columnHints = request.context
      ? buildColumnHints(request.context)
      : "";
    const currentSchema = request.context?.currentSchema || "public";
    const availableTables = request.context?.availableTables || [];

    // Enhanced context: Identify the currently selected/focused table
    const selectedTableInfo = request.context?.selectedTable;
    let focusedTableContext = "";

    if (selectedTableInfo && request.context?.tables) {
      const tables = request.context.tables;
      const focusedTable = tables.find(
        (t: DatabaseTable | Record<string, unknown>) => {
          const tableName =
            "table_name" in t
              ? t.table_name
              : (t as Record<string, unknown>).name;
          const tableSchema =
            "table_schema" in t
              ? t.table_schema
              : (t as Record<string, unknown>).schema;
          return (
            tableName === selectedTableInfo.table &&
            (tableSchema === selectedTableInfo.schema ||
              currentSchema === selectedTableInfo.schema)
          );
        }
      );

      if (focusedTable) {
        const tableName =
          "table_name" in focusedTable
            ? focusedTable.table_name
            : (focusedTable as Record<string, unknown>).name;
        const tableSchema =
          "table_schema" in focusedTable
            ? focusedTable.table_schema
            : (focusedTable as Record<string, unknown>).schema;
        const fullTableName = `${tableSchema}."${tableName}"`;

        let columnsInfo = "";
        if ("columns" in focusedTable) {
          const columns = focusedTable.columns as (
            | DatabaseColumn
            | Record<string, unknown>
          )[];
          columnsInfo = columns
            .map((col) => {
              const colName =
                "column_name" in col
                  ? col.column_name
                  : (col as Record<string, unknown>).name;
              const colType =
                "data_type" in col
                  ? col.data_type
                  : (col as Record<string, unknown>).type;
              const isPK =
                "is_primary_key" in col
                  ? col.is_primary_key
                  : (col as Record<string, unknown>).primaryKey;
              const isFK =
                "is_foreign_key" in col
                  ? col.is_foreign_key
                  : (col as Record<string, unknown>).foreignKey;
              const nullable =
                "is_nullable" in col
                  ? col.is_nullable
                  : (col as Record<string, unknown>).nullable;

              let info = `  - ${colName}: ${colType}`;
              if (isPK) info += " [PRIMARY KEY]";
              if (isFK) info += " [FOREIGN KEY]";
              if (!nullable) info += " [NOT NULL]";
              return info;
            })
            .join("\n");
        }

        focusedTableContext = `\n🎯 CURRENTLY SELECTED TABLE (PRIMARY FOCUS):
Table: ${fullTableName}
Columns:
${columnsInfo}

⚠️ IMPORTANT: The user is currently viewing this table. Unless they explicitly mention another table,
generate queries that work with THIS table using its exact column names shown above.
`;
      }
    }

    const prompt = `
You are a PostgreSQL expert specializing in generating accurate, production-ready SQL queries.

${focusedTableContext}

Database Context:
${databaseContext}

${columnHints}

Current Schema: ${currentSchema}
${
  availableTables.length > 0
    ? `Available Tables: ${availableTables.join(", ")}`
    : ""
}
${
  request.context?.tableNames
    ? `Table Names (use exactly as shown): ${request.context.tableNames.join(
        ", "
      )}`
    : ""
}

Natural Language Query: "${request.naturalLanguage}"

═══════════════════════════════════════════════════════════════════
CRITICAL PostgreSQL RULES (MUST FOLLOW):
═══════════════════════════════════════════════════════════════════

1. ✅ TABLE & COLUMN NAMES:
   - Use ONLY exact table/column names from the context above
   - NEVER invent, guess, or assume column names
   - Always schema-qualify: schema."TableName"
   - If the focused table is shown above, prioritize using it unless user asks otherwise

2. ✅ SMART COLUMN MATCHING (HANDLE TYPOS & VAGUE REFERENCES):
   When the user mentions a column vaguely or with typos, be intelligent:
   
   a) Temporal references → Use timestamp/date columns:
      User says: "date", "time", "when", "created", "yesterday", "today", "recent", "last week"
      → Look for: created_at, updated_at, timestamp, date, createdat, etc.
      → Prefer created_at for "when created" or general date references
      → Use updated_at for "last modified" or "recent updates"
   
   b) Identity references → Use ID columns:
      User says: "id", "identifier", "key", "primary key"
      → Look for: id, user_id, customer_id, etc.
   
   c) Name/Label references → Use name/title columns:
      User says: "name", "title", "called", "label"
      → Look for: name, title, username, full_name, label, etc.
   
   d) Status references → Use status/state columns:
      User says: "status", "state", "condition"
      → Look for: status, state, is_active, etc.
   
   e) Quantitative references → Use count/amount columns:
      User says: "count", "amount", "total", "how many", "number"
      → Look for: count, amount, total, quantity, etc.
   
   f) Boolean references → Use boolean/flag columns:
      User says: "is", "has", "active", "enabled"
      → Look for: is_active, is_deleted, has_permission, etc.
   
   g) Typo tolerance:
      - "crated_at" → created_at
      - "timestmp" → timestamp
      - "updted" → updated
      - "usr_id" → user_id
      - Match similar column names using closest semantic match
   
   ⚠️ If you infer a column (due to typo/vague reference), MENTION it in explanation:
      "Interpreted 'date' as 'created_at' based on available columns"

3. ✅ ORDER BY Smart Defaults:
   - When user says "order by date" → use the most relevant timestamp column (created_at preferred)
   - When user says "recent" or "latest" → ORDER BY timestamp DESC
   - When user says "oldest" or "first" → ORDER BY timestamp ASC
   - Always specify ASC/DESC explicitly

4. ✅ DATA TYPE CASTING (CRITICAL - COMMON ERROR SOURCE):
   PostgreSQL is STRICT about type compatibility. Follow these rules precisely:

   a) TIMESTAMP/DATE Comparisons:
      ❌ WRONG: WHERE textcolumn > '2025-10-25T05:54:33.187+00:00'::textcolumn
      ✅ RIGHT: WHERE textcolumn::timestamp > '2025-10-25T05:54:33.187+00:00'
      ✅ RIGHT: WHERE CAST(textcolumn AS timestamp) > '2025-10-25T05:54:33.187+00:00'
      ✅ RIGHT: WHERE textcolumn::timestamptz > TIMESTAMP '2025-10-25 05:54:33'
      
      Rule: Cast the COLUMN (not the literal) when types mismatch
      
   b) Date/Time Functions:
      ✅ NOW() - current timestamp with timezone
      ✅ CURRENT_DATE - current date
      ✅ CURRENT_TIMESTAMP - current timestamp
      ✅ TO_TIMESTAMP(text, format) - convert string to timestamp
      ✅ TO_DATE(text, format) - convert string to date
      
   c) Relative Date Patterns:
      - Yesterday: WHERE date_column::date = CURRENT_DATE - INTERVAL '1 day'
      - Today: WHERE date_column::date = CURRENT_DATE
      - Last 7 days: WHERE date_column >= CURRENT_DATE - INTERVAL '7 days'
      - This week: WHERE date_column >= DATE_TRUNC('week', CURRENT_DATE)
      - This month: WHERE date_column >= DATE_TRUNC('month', CURRENT_DATE)
      - This year: WHERE date_column >= DATE_TRUNC('year', CURRENT_DATE)
      - Greater than yesterday: WHERE date_column::date > CURRENT_DATE - INTERVAL '1 day'

5. ✅ TEXT vs NUMERIC:
   - Never compare text with numbers directly
   ✅ RIGHT: WHERE numeric_column::text LIKE '%pattern%' (when searching numbers as text)
   ✅ RIGHT: WHERE text_column::integer > 100 (when column contains numeric strings)

6. ✅ JSON/JSONB Handling:
   ✅ RIGHT: WHERE json_column->>'key' = 'value' (text extraction)
   ✅ RIGHT: WHERE json_column->'key' = '"value"' (JSON extraction)
   ✅ RIGHT: WHERE json_column @> '{"key": "value"}' (containment)

7. ✅ BOOLEAN Handling:
   ✅ RIGHT: WHERE boolean_column = true
   ✅ RIGHT: WHERE boolean_column IS TRUE
   ✅ RIGHT: WHERE NOT boolean_column

8. ✅ NULL Handling:
   ✅ RIGHT: WHERE column IS NULL
   ✅ RIGHT: WHERE column IS NOT NULL
   ❌ WRONG: WHERE column = NULL

9. ✅ STRING Matching:
   - LIKE: case-sensitive pattern matching (use % wildcards)
   - ILIKE: case-insensitive pattern matching
   ✅ RIGHT: WHERE name ILIKE '%john%' (find john anywhere, case-insensitive)

10. ✅ QUERY SAFETY:
    - SELECT: Always add LIMIT 100 unless user specifies otherwise
    - UPDATE/DELETE: ALWAYS include WHERE clause (never unbounded)
    - Use ORDER BY for consistent results

11. ✅ IF COLUMN/TABLE NOT FOUND:
    - DO NOT make up names
    - Use semantic matching from Column Hints above
    - Explain your inference in the explanation
    - If truly not found, list available options in suggestions

═══════════════════════════════════════════════════════════════════
EXAMPLES OF CORRECT QUERIES WITH SMART MATCHING:
═══════════════════════════════════════════════════════════════════

Example 1 - Vague date reference:
Natural: "Show records from yesterday"
Smart Match: User said "yesterday" → use created_at/timestamp column
✅ SELECT * FROM public."ApiLog" 
   WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day'
   LIMIT 100;

Example 2 - Typo in column:
Natural: "Order by crated date"
Smart Match: "crated date" → created_at
✅ SELECT * FROM public."ApiLog" 
   ORDER BY created_at DESC 
   LIMIT 100;

Example 3 - "Greater than yesterday" query:
Natural: "Show entries greater than yesterday's date order by"
Smart Match: "greater than yesterday" + "order by" → created_at > yesterday, ORDER BY created_at
✅ SELECT * FROM public."ApiLog" 
   WHERE created_at::date > CURRENT_DATE - INTERVAL '1 day'
   ORDER BY created_at DESC 
   LIMIT 100;

Example 4 - Recent with vague time:
Natural: "Show recent entries"
Smart Match: "recent" → use timestamp, order descending
✅ SELECT * FROM public."ApiLog" 
   WHERE created_at > NOW() - INTERVAL '1 day'
   ORDER BY created_at DESC 
   LIMIT 100;

Example 5 - Specific timestamp:
Natural: "Records after 2025-10-25 05:54:33"
✅ SELECT * FROM public."ApiLog" 
   WHERE created_at::timestamp > '2025-10-25 05:54:33'
   ORDER BY created_at DESC 
   LIMIT 100;

Example 6 - Text search with typo:
Natural: "Find users with nam containing John"
Smart Match: "nam" → name
✅ SELECT * FROM public."Users" 
   WHERE name ILIKE '%john%' 
   LIMIT 100;

Example 7 - Count with vague reference:
Natural: "How many records today"
Smart Match: "today" → created_at::date = CURRENT_DATE
✅ SELECT COUNT(*) 
   FROM public."ApiLog" 
   WHERE created_at::date = CURRENT_DATE;

═══════════════════════════════════════════════════════════════════

Format your response as JSON:
{
  "sql": "your generated SQL query here",
  "explanation": "brief explanation including any column inferences made",
  "confidence": 0.85,
  "suggestions": ["optional suggestion 1", "optional suggestion 2"]
}

Important: Only return the JSON object, no additional text.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    try {
      // Try to parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }

      const parsedResponse: AIQueryResponse = JSON.parse(jsonMatch[0]);

      // Validate the response structure
      if (!parsedResponse.sql || !parsedResponse.explanation) {
        throw new Error("Invalid response structure from AI");
      }

      // Ensure confidence is between 0 and 1
      parsedResponse.confidence = Math.max(
        0,
        Math.min(1, parsedResponse.confidence || 0.5)
      );

      return parsedResponse;
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);

      // Fallback: try to extract SQL from the response
      const sqlMatch = text.match(
        /(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP)[\s\S]*?(?:;|$)/i
      );

      return {
        sql: sqlMatch
          ? sqlMatch[0].trim()
          : "SELECT 1; -- Failed to generate query",
        explanation:
          "The AI generated a response but it could not be properly parsed. Please review the SQL manually.",
        confidence: 0.3,
        suggestions: [
          "Please verify the generated SQL before executing",
          "Consider rephrasing your natural language query",
        ],
      };
    }
  } catch (error: unknown) {
    console.error("Gemini API error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`AI query conversion failed: ${errorMessage}`);
  }
};

export const explainSQL = async (
  sqlQuery: string,
  tables?: DatabaseTable[]
): Promise<string> => {
  if (!genAI) {
    throw new Error("Gemini is not initialized. Please provide an API key.");
  }

  try {
    // Use gemini-2.0-flash for explanations (faster, less critical)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const databaseContext = tables ? generateDatabaseContext({ tables }) : "";

    const prompt = `
You are a PostgreSQL expert. Explain the following SQL query in simple terms.

${databaseContext ? `Database Context:\n${databaseContext}\n` : ""}

SQL Query:
${sqlQuery}

Provide a clear, concise explanation of what this query does, including:
1. What operation is being performed (SELECT, INSERT, UPDATE, DELETE, etc.)
2. Which tables/columns are involved
3. Any filtering conditions (WHERE clauses)
4. Any joins or relationships
5. Expected results or impact

Keep the explanation user-friendly for non-technical users.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error: unknown) {
    console.error("SQL explanation error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return `Failed to explain SQL query: ${errorMessage}`;
  }
};

export const suggestQueryImprovements = async (
  sqlQuery: string,
  tables?: DatabaseTable[]
): Promise<string[]> => {
  if (!genAI) {
    throw new Error("Gemini is not initialized. Please provide an API key.");
  }

  try {
    // Use gemini-2.0-flash for suggestions (faster, less critical)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const databaseContext = tables ? generateDatabaseContext({ tables }) : "";

    const prompt = `
You are a PostgreSQL performance expert. Analyze the following SQL query and suggest improvements.

${databaseContext ? `Database Context:\n${databaseContext}\n` : ""}

SQL Query:
${sqlQuery}

Provide specific suggestions for:
1. Performance optimizations
2. Index recommendations
3. Query structure improvements
4. Security considerations
5. Best practices

Format your response as a JSON array of strings:
["suggestion 1", "suggestion 2", "suggestion 3"]

Only return the JSON array, no additional text.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn("Failed to parse suggestions:", parseError);
    }

    // Fallback: return basic suggestions
    return [
      "Consider adding appropriate indexes for better performance",
      "Review WHERE clauses for optimization",
    ];
  } catch (error: unknown) {
    console.error("Query improvement suggestions error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return [`Failed to generate suggestions: ${errorMessage}`];
  }
};
