import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";
import { DatabaseConnection } from "@/types/database";

export async function POST(request: NextRequest) {
  try {
    const connection: DatabaseConnection = await request.json();

    // Validate required fields
    if (
      !connection.host ||
      !connection.database ||
      !connection.username ||
      !connection.password
    ) {
      return NextResponse.json(
        { success: false, error: "Missing required connection parameters" },
        { status: 400 }
      );
    }

    // Test the connection
    const isValid = await DatabaseService.testConnection(connection);

    if (isValid) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, error: "Connection failed" },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error("Database connection test error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to test database connection",
      },
      { status: 500 }
    );
  }
}
