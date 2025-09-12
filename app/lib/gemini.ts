import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  AIQueryRequest,
  AIQueryResponse,
  DatabaseTable,
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

const generateDatabaseContext = (context: any): string => {
  if (!context || !context.tables || context.tables.length === 0) {
    return "No table information available.";
  }

  // Handle both old format (DatabaseTable[]) and new enhanced format
  const tables = context.tables;

  return tables
    .map((table: any) => {
      // Handle enhanced table format from EnhancedAIAssistant
      if (table.name && table.columns) {
        const columns = table.columns
          .map((col: any) => {
            let colInfo = `${col.name} (${col.type}`;
            if (col.primaryKey) colInfo += ", PRIMARY KEY";
            if (col.foreignKey) colInfo += ", FOREIGN KEY";
            if (!col.nullable) colInfo += ", NOT NULL";
            colInfo += ")";
            return colInfo;
          })
          .join(", ");

        let tableInfo = `Table: ${table.fullTableName || table.schema + '."' + table.name + '"'
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
      const columns = table.columns
        .map((col: any) => {
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

export const convertNaturalLanguageToSQL = async (
  request: AIQueryRequest
): Promise<AIQueryResponse> => {
  if (!genAI) {
    throw new Error("Gemini is not initialized. Please provide an API key.");
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const databaseContext = request.context
      ? generateDatabaseContext(request.context)
      : "";
    const currentSchema = request.context?.currentSchema || "public";
    const availableTables = request.context?.availableTables || [];

    const prompt = `
You are a PostgreSQL expert. Convert the following natural language query into a PostgreSQL SQL statement.

Database Context:
${databaseContext}

Current Schema: ${currentSchema}
${availableTables.length > 0
        ? `Available Tables: ${availableTables.join(", ")}`
        : ""
      }
${request.context?.tableNames
        ? `Table Names (use exactly as shown): ${request.context.tableNames.join(
          ", "
        )}`
        : ""
      }

Natural Language Query: "${request.naturalLanguage}"

CRITICAL RULES:
1. Use ONLY the exact table and column names present in the context. Never invent or guess names.
2. Use ONLY tables listed in Available Tables. If a table/column is missing, state that explicitly in suggestions.
3. Always schema-qualify tables with quotes: schema."TableName".
4. Generate ONLY valid PostgreSQL SQL.
5. For UPDATE/DELETE, include restrictive WHERE clauses; never unbounded.
6. For SELECT, apply LIMIT 100 unless the user specifies otherwise.
7. Respect data types and use proper PostgreSQL functions for time/date.
8. Use explicit JOIN ... ON with provided column names only.
9. If exact mapping is not possible, return the closest valid SQL and list gaps in suggestions.

IMPORTANT: If you cannot find the exact column mentioned in the query, DO NOT make one up. Instead, suggest using available columns or explain why the query cannot be fulfilled.

Format your response as JSON:
{
  "sql": "your generated SQL query here",
  "explanation": "brief explanation of what the query does",
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
  } catch (error: any) {
    console.error("Gemini API error:", error);

    throw new Error(
      `AI query conversion failed: ${error.message || "Unknown error"}`
    );
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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const databaseContext = tables ? generateDatabaseContext(tables) : "";

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
  } catch (error: any) {
    console.error("SQL explanation error:", error);
    return `Failed to explain SQL query: ${error.message || "Unknown error"}`;
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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const databaseContext = tables ? generateDatabaseContext(tables) : "";

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
  } catch (error: any) {
    console.error("Query improvement suggestions error:", error);
    return [
      `Failed to generate suggestions: ${error.message || "Unknown error"}`,
    ];
  }
};
