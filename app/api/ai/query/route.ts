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

    // Validate generated SQL against the live connection using EXPLAIN
    try {
      const connectionId = context?.connectionId;
      if (!connectionId) {
        throw new Error("Missing connectionId for validation");
      }
      await DatabaseService.executeQuery(connectionId, `EXPLAIN ${response.sql}`);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json(
        { error: `SQL validation failed: ${errorMessage}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ response });
  } catch (error: unknown) {
    console.error("AI query conversion error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to convert natural language to SQL";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
