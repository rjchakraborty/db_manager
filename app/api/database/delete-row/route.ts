import { NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/lib/database";

export async function POST(request: NextRequest) {
    try {
        const { connectionId, schema, tableName, primaryKey } = await request.json();

        if (!connectionId || !schema || !tableName || !primaryKey) {
            return NextResponse.json(
                { error: "Missing required parameters" },
                { status: 400 }
            );
        }

        // Build WHERE clause from primary key
        const whereConditions = Object.entries(primaryKey)
            .map(([key, value]) => `"${key}" = $${Object.keys(primaryKey).indexOf(key) + 1}`)
            .join(" AND ");

        const query = `DELETE FROM "${schema}"."${tableName}" WHERE ${whereConditions}`;
        const params = Object.values(primaryKey);

        console.log("Delete query:", query);
        console.log("Parameters:", params);

        const result = await DatabaseService.executeQuery(connectionId, query, params);

        return NextResponse.json({
            success: true,
            rowsAffected: result.rowCount,
            message: `Deleted ${result.rowCount} row(s)`
        });
    } catch (error: any) {
        console.error("Delete row error:", error);

        // Handle foreign key constraint violations specifically
        if (error.code === '23503') {
            const detail = error.detail || '';
            const referencedTable = detail.match(/from table "([^"]+)"/)?.[1];
            const keyValue = detail.match(/Key \([^)]+\)=\(([^)]+)\)/)?.[1];

            return NextResponse.json(
                {
                    error: "Cannot delete this record because it is referenced by other data",
                    errorType: "FOREIGN_KEY_VIOLATION",
                    detail: error.detail,
                    referencedTable,
                    keyValue,
                    suggestion: referencedTable
                        ? `This record is referenced in the "${referencedTable}" table. Delete those records first, or use cascade delete if available.`
                        : "This record is referenced by other data. Delete the dependent records first."
                },
                { status: 409 } // Conflict status code
            );
        }

        return NextResponse.json(
            { error: error.message || "Failed to delete row" },
            { status: 500 }
        );
    }
}
