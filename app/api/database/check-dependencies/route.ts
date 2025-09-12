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

        // Get foreign key relationships for this table
        const foreignKeyQuery = `
      SELECT 
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE 
        tc.constraint_type = 'FOREIGN KEY' 
        AND ccu.table_name = $1 
        AND ccu.table_schema = $2;
    `;

        const fkResult = await DatabaseService.executeQuery(
            connectionId,
            foreignKeyQuery,
            [tableName, schema]
        );

        const dependencies = [];

        // Check each foreign key relationship
        for (const fk of fkResult.rows) {
            const pkColumns = Object.keys(primaryKey);
            const pkValues = Object.values(primaryKey);

            // Build a query to check if this record is referenced
            const checkQuery = `
        SELECT COUNT(*) as count 
        FROM "${schema}"."${fk.table_name}" 
        WHERE "${fk.column_name}" = $1
      `;

            try {
                const countResult = await DatabaseService.executeQuery(
                    connectionId,
                    checkQuery,
                    [primaryKey[fk.foreign_column_name]]
                );

                const count = parseInt(countResult.rows[0].count) || 0;

                if (count > 0) {
                    dependencies.push({
                        table: fk.table_name,
                        column: fk.column_name,
                        count: count,
                        constraintName: fk.constraint_name
                    });
                }
            } catch (error) {
                console.error(`Error checking dependency for ${fk.table_name}:`, error);
            }
        }

        return NextResponse.json({
            dependencies,
            canDelete: dependencies.length === 0,
            message: dependencies.length === 0
                ? "Record can be safely deleted"
                : `Record is referenced by ${dependencies.length} other table(s)`
        });

    } catch (error: any) {
        console.error("Check dependencies error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to check dependencies" },
            { status: 500 }
        );
    }
}
