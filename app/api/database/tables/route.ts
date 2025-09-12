import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId");
    const schemaName = searchParams.get("schema");

    if (!connectionId || !schemaName) {
      return NextResponse.json(
        { error: "Connection ID and schema name are required" },
        { status: 400 }
      );
    }

    const tables = await DatabaseService.getTables(connectionId, schemaName);

    return NextResponse.json({ tables });
  } catch (error: any) {
    console.error("Get tables error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to fetch tables" },
      { status: 500 }
    );
  }
}
