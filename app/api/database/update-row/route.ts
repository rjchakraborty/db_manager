import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function POST(request: NextRequest) {
    try {
        const { connectionId, schema, tableName, primaryKey, updates } = await request.json();

        if (!connectionId || !schema || !tableName || !primaryKey || !updates) {
            return NextResponse.json(
                { error: "Missing required parameters" },
                { status: 400 }
            );
        }

        // Build WHERE clause from primary key
        const whereConditions = Object.keys(primaryKey)
            .map((key, index) => `"${key}" = $${index + 1}`)
            .join(" AND ");

        // Build SET clause from updates
        const setClause = Object.keys(updates)
            .map((key, index) => `"${key}" = $${Object.keys(primaryKey).length + index + 1}`)
            .join(", ");

        const query = `UPDATE "${schema}"."${tableName}" SET ${setClause} WHERE ${whereConditions}`;

        // Combine primary key values and update values for parameters
        const params = [...Object.values(primaryKey), ...Object.values(updates)];

        console.log("Update query:", query);
        console.log("Parameters:", params);

        const result = await DatabaseService.executeQuery(connectionId, query, params);

        return NextResponse.json({
            success: true,
            rowsAffected: result.rowCount,
            message: `Updated ${result.rowCount} row(s)`
        });
    } catch (error: unknown) {
        console.error("Update row error:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to update row";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}
