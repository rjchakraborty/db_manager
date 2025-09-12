import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function POST(request: NextRequest) {
    try {
        const connection = await request.json();


        const success = await DatabaseService.createConnection(connection);

        if (success) {
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json(
                { success: false, error: "Connection test failed" },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error("Connect and test error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Connection failed" },
            { status: 500 }
        );
    }
}
