import { NextRequest, NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnel-manager';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (id) {
            // Get status for specific tunnel
            const status = tunnelManager.getTunnelStatus(id);
            return NextResponse.json({
                success: true,
                status
            });
        } else {
            // Get all tunnel statuses
            const statuses = tunnelManager.getAllTunnelStatuses();
            return NextResponse.json({
                success: true,
                statuses
            });
        }
    } catch (error) {
        console.error('Tunnel status error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get tunnel status'
            },
            { status: 500 }
        );
    }
}
