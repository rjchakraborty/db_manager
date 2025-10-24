import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const rawConnection = await request.json();

    // Auto-detect if connection requires tunnel based on hostname
    // RDS hostnames contain '.rds.amazonaws.com' and require SSH tunnel
    const isRDSHost =
      rawConnection.host?.includes(".rds.amazonaws.com") ||
      rawConnection.host?.includes("pistonpay-production");

    // Determine if tunnel is required: explicit setting OR auto-detected RDS host
    const needsTunnel = rawConnection.requiresTunnel === true || isRDSHost;

    // Normalize the connection object to handle legacy/malformed data
    const connection = {
      ...rawConnection,
      // Use tunnel if explicitly set OR auto-detected
      requiresTunnel: needsTunnel,
      // Force SSL to true if tunnel is required (RDS requires SSL even through SSH tunnel)
      ssl: needsTunnel ? true : rawConnection.ssl || false,
      // Use localhost if tunnel is required
      host: needsTunnel ? "localhost" : rawConnection.host,
    };

    // Debug logging
    console.log("📥 Received connection config:", {
      ...connection,
      password: "***",
      requiresTunnel: connection.requiresTunnel,
      ssl: connection.ssl,
      autoDetectedTunnel: isRDSHost
        ? "✅ RDS host detected"
        : "❌ Direct connection",
    });

    const success = await DatabaseService.createConnection(connection);

    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, error: "Connection test failed" },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    console.error("Connect and test error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Connection failed";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
