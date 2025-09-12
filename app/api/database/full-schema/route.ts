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

        const schemas = await DatabaseService.getFullSchema(connectionId);
        return NextResponse.json({ schemas });
    } catch (error: any) {
        console.error("Get full schema error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch full schema" },
            { status: 500 }
        );
    }
}


