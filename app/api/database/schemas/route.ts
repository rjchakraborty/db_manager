import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Connection ID is required" },
        { status: 400 }
      );
    }

    const schemas = await DatabaseService.getSchemas(connectionId);

    return NextResponse.json({ schemas });
  } catch (error: unknown) {
    console.error("Get schemas error:", error);

    const errorMessage = error instanceof Error ? error.message : "Failed to fetch schemas";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
