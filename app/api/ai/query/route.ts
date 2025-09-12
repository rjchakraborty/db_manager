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
    } catch (e: any) {
      return NextResponse.json(
        { error: `SQL validation failed: ${e?.message || "Unknown error"}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ response });
  } catch (error: any) {
    console.error("AI query conversion error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to convert natural language to SQL" },
      { status: 500 }
    );
  }
}
