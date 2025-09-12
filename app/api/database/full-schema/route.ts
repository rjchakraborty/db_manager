import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

async function retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.log(`Full schema operation failed (attempt ${attempt}/${maxRetries}):`, error instanceof Error ? error.message : error);

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    throw lastError;
}

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

        const schemas = await retryOperation(
            () => DatabaseService.getFullSchema(connectionId),
            3,
            2000 // Longer delay for full schema as it's more complex
        );

        return NextResponse.json({ schemas });
    } catch (error: unknown) {
        console.error("Get full schema error:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to fetch full schema";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}


