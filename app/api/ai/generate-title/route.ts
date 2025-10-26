import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
  try {
    const { sql, apiKey } = await request.json();

    if (!sql || typeof sql !== "string") {
      return NextResponse.json(
        { error: "SQL query is required" },
        { status: 400 }
      );
    }

    // If no API key, return a simple auto-generated title
    if (!apiKey) {
      return NextResponse.json({
        title: generateSimpleTitle(sql),
        description: null,
      });
    }

    try {
      // Initialize Gemini 2.0 Flash
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

      // Create a focused prompt for title generation
      const prompt = `Analyze this SQL query and generate a short, descriptive title (maximum 60 characters) that clearly explains what the query does. Focus on the business logic and intent, not the SQL syntax.

SQL Query:
\`\`\`sql
${sql}
\`\`\`

Requirements:
- Maximum 60 characters
- Describe WHAT the query retrieves, not HOW
- Include key filters or conditions if present
- Be specific and meaningful
- Don't include SQL keywords like SELECT, FROM, WHERE
- Reply with ONLY the title text, nothing else

Examples:
- "API logs for gas station transactions by person 8401"
- "Recent user orders with pending status"
- "Top 10 products by sales this month"

Title:`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let title = response.text().trim();

      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, "");

      // Remove common prefixes
      title = title.replace(
        /^(Title:|Query:|SQL:|Here is the title:|The title is:)\s*/gi,
        ""
      );

      // Truncate if too long
      if (title.length > 60) {
        title = title.substring(0, 57) + "...";
      }

      // Validate the title
      if (
        !title ||
        title.length < 5 ||
        title.toLowerCase().includes("select") ||
        title.toLowerCase().includes("from") ||
        title.toLowerCase().includes("where")
      ) {
        title = generateSimpleTitle(sql);
      }

      return NextResponse.json({
        title,
        description: null,
      });
    } catch (aiError) {
      console.error("AI title generation failed:", aiError);
      // Fallback to simple title generation
      return NextResponse.json({
        title: generateSimpleTitle(sql),
        description: null,
      });
    }
  } catch (error: unknown) {
    console.error("Error generating title:", error);
    return NextResponse.json(
      { error: "Failed to generate title" },
      { status: 500 }
    );
  }
}

/**
 * Generate a simple title from SQL query
 */
function generateSimpleTitle(sql: string): string {
  const normalizedSql = sql.trim().toUpperCase();

  // Extract table name if possible
  const tableMatch =
    normalizedSql.match(/FROM\s+["']?(\w+)["']?/i) ||
    normalizedSql.match(/UPDATE\s+["']?(\w+)["']?/i) ||
    normalizedSql.match(/INSERT\s+INTO\s+["']?(\w+)["']?/i) ||
    normalizedSql.match(/DELETE\s+FROM\s+["']?(\w+)["']?/i);

  const tableName = tableMatch ? tableMatch[1] : "data";

  if (normalizedSql.startsWith("SELECT")) {
    if (normalizedSql.includes("COUNT")) {
      return `Count records in ${tableName}`;
    } else if (normalizedSql.includes("WHERE")) {
      return `Filter ${tableName} records`;
    } else if (normalizedSql.includes("JOIN")) {
      return `Join ${tableName} with other tables`;
    } else if (normalizedSql.includes("ORDER BY")) {
      return `Sort ${tableName} records`;
    } else if (normalizedSql.includes("GROUP BY")) {
      return `Group ${tableName} records`;
    } else {
      return `View ${tableName} records`;
    }
  } else if (normalizedSql.startsWith("INSERT")) {
    return `Insert into ${tableName}`;
  } else if (normalizedSql.startsWith("UPDATE")) {
    return `Update ${tableName}`;
  } else if (normalizedSql.startsWith("DELETE")) {
    return `Delete from ${tableName}`;
  } else if (normalizedSql.startsWith("CREATE")) {
    return `Create ${tableName}`;
  } else if (normalizedSql.startsWith("DROP")) {
    return `Drop ${tableName}`;
  } else if (normalizedSql.startsWith("ALTER")) {
    return `Alter ${tableName}`;
  }

  return `Query ${tableName}`;
}
