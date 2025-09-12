import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

async function retryQuery(
  connectionId: string,
  query: string,
  maxRetries: number = 3
): Promise<{ rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[]; rowCount: number; command: string; duration: number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await DatabaseService.executeQuery(connectionId, query);
    } catch (error) {
      lastError = error;
      console.log(`Query execution failed (attempt ${attempt}/${maxRetries}):`, error instanceof Error ? error.message : error);

      // Don't retry on syntax errors or permission errors
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('syntax error') ||
          errorMessage.includes('permission denied') ||
          errorMessage.includes('does not exist')) {
          throw error; // Don't retry these types of errors
        }
      }

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const { connectionId, query } = await request.json();

    if (!connectionId || !query) {
      return NextResponse.json(
        { error: "Connection ID and query are required" },
        { status: 400 }
      );
    }

    const result = await retryQuery(connectionId, query, 3);

    return NextResponse.json({ result });
  } catch (error: unknown) {
    console.error("Query execution error:", error);

    const errorMessage = error instanceof Error ? error.message : "Failed to execute query";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
