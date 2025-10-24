import { NextRequest, NextResponse } from "next/server";
import { initializeGemini, convertNaturalLanguageToSQL } from "@/lib/gemini";
import { AIQueryRequest } from "@/types/database";
import { DatabaseService } from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const { apiKey, naturalLanguage, context } = (await request.json()) as {
      apiKey?: string;
      naturalLanguage: string;
      context?: AIQueryRequest["context"] & { connectionId?: string };
    };

    if (!naturalLanguage) {
      return NextResponse.json(
        { error: "Natural language query is required" },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Gemini API key is required. Please provide one or set GEMINI_API_KEY environment variable.",
        },
        { status: 400 }
      );
    }

    initializeGemini(apiKey);

    const response = await convertNaturalLanguageToSQL({
      naturalLanguage,
      context,
    });

    console.log("🤖 Generated SQL:", response.sql);
    console.log("📊 AI Confidence:", response.confidence);

    // Validate generated SQL against the live connection using EXPLAIN
    let validationWarning: string | null = null;
    const connectionId = context?.connectionId;

    if (connectionId) {
      try {
        console.log("⏳ Validating SQL with EXPLAIN...");
        await DatabaseService.executeQuery(
          connectionId,
          `EXPLAIN ${response.sql}`
        );
        console.log("✅ SQL validation passed");
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        console.warn("⚠️ SQL validation failed (non-fatal):", errorMessage);
        console.warn("Generated SQL:", response.sql);

        // If validation fails due to connection issues, just warn but continue
        if (
          errorMessage.includes("No configuration found") ||
          errorMessage.includes("Failed to establish database connection")
        ) {
          validationWarning =
            "Could not validate SQL (connection unavailable). Please review before executing.";
        } else {
          // For actual SQL errors, add them as suggestions
          validationWarning = `SQL validation warning: ${errorMessage}`;
          response.suggestions = [
            ...(response.suggestions || []),
            `Validation error: ${errorMessage}`,
            "Please review and test the SQL before executing",
          ];
        }
      }
    } else {
      console.log("⏭️ Skipping SQL validation (no connectionId provided)");
      validationWarning = "SQL validation skipped (no active connection)";
    }

    return NextResponse.json({
      response,
      validationWarning,
    });
  } catch (error: unknown) {
    console.error("AI query conversion error:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to convert natural language to SQL";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
