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
  } catch (error: any) {
    console.error("Get schemas error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to fetch schemas" },
      { status: 500 }
    );
  }
}
