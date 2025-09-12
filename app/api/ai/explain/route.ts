import { NextRequest, NextResponse } from "next/server";
import { initializeGemini, explainSQL } from "@/lib/gemini";
import { DatabaseTable } from "@/types/database";

export async function POST(request: NextRequest) {
  try {
    const {
      apiKey,
      sqlQuery,
      tables,
    }: {
      apiKey: string;
      sqlQuery: string;
      tables?: DatabaseTable[];
    } = await request.json();

    if (!apiKey || !sqlQuery) {
      return NextResponse.json(
        { error: "API key and SQL query are required" },
        { status: 400 }
      );
    }

    // Initialize Gemini with the provided API key
    initializeGemini(apiKey);

    // Explain the SQL query
    const explanation = await explainSQL(sqlQuery, tables);

    return NextResponse.json({ explanation });
  } catch (error: unknown) {
    console.error("SQL explanation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to explain SQL query";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
