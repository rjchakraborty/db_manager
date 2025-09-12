import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const connectionId = searchParams.get('connectionId');

        if (!connectionId) {
            return NextResponse.json(
                { error: "Connection ID is required" },
                { status: 400 }
            );
        }

        // In a real app, this would fetch from a database
        // For now, we'll return an empty array as favorites are stored client-side
        return NextResponse.json({ favorites: [] });

    } catch (error: unknown) {
        console.error("Error fetching favorites:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to fetch favorites";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const { connectionId, name, sql, description } = await request.json();

        if (!connectionId || !name || !sql) {
            return NextResponse.json(
                { error: "Connection ID, name, and SQL are required" },
                { status: 400 }
            );
        }

        // In a real app, this would save to a database
        // For now, we'll just return success as favorites are stored client-side
        const favorite = {
            id: Date.now().toString(),
            connectionId,
            name,
            sql,
            description: description || "",
            createdAt: new Date().toISOString()
        };

        return NextResponse.json({ favorite });

    } catch (error: unknown) {
        console.error("Error saving favorite:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to save favorite";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const favoriteId = searchParams.get('id');

        if (!favoriteId) {
            return NextResponse.json(
                { error: "Favorite ID is required" },
                { status: 400 }
            );
        }

        // In a real app, this would delete from a database
        // For now, we'll just return success as favorites are stored client-side
        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        console.error("Error deleting favorite:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to delete favorite";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}
