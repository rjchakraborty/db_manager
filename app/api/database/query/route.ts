import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const { connectionId, query } = await request.json();

    if (!connectionId || !query) {
      return NextResponse.json(
        { error: "Connection ID and query are required" },
        { status: 400 }
      );
    }

    const result = await DatabaseService.executeQuery(connectionId, query);

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
