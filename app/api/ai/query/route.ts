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

    // Note: SQL validation is disabled to avoid executing queries
    // The user can review and test the generated SQL manually

    return NextResponse.json({
      response,
      validationWarning: null,
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
