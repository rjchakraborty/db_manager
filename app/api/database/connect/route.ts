import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";
import { DatabaseConnection } from "@/types/database";

export async function POST(request: NextRequest) {
  try {
    const connection: DatabaseConnection = await request.json();

    // Create or get existing connection
    await DatabaseService.createConnection(connection);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Database connection error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to connect to database";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("id");

    if (!connectionId) {
      return NextResponse.json(
        { error: "Connection ID is required" },
        { status: 400 }
      );
    }

    await DatabaseService.closeConnection(connectionId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Database disconnection error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to disconnect from database";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
