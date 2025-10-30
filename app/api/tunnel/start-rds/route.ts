import { NextRequest, NextResponse } from "next/server";
import { tunnelManager } from "@/lib/tunnel-manager";

export async function POST(request: NextRequest) {
  try {
    console.log(
      "Starting RDS tunnel - passphrase will be prompted in terminal..."
    );

    const status = await tunnelManager.startRDSTunnel();

    return NextResponse.json({
      success: status.isActive,
      status,
      error: status.error,
      message: status.isActive
        ? "RDS tunnel started successfully! Database is accessible at localhost:5432"
        : "Failed to start RDS tunnel",
    });
  } catch (error) {
    console.error("RDS tunnel start error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to start RDS tunnel",
        message: "An error occurred while starting the RDS tunnel",
      },
      { status: 500 }
    );
  }
}
