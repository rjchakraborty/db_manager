import { NextRequest, NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnel-manager';

export async function POST(request: NextRequest) {
    try {
        const { id } = await request.json();

        if (!id) {
            return NextResponse.json(
                { success: false, error: 'Tunnel ID is required' },
                { status: 400 }
            );
        }

        await tunnelManager.stopTunnel(id);

        return NextResponse.json({
            success: true,
            message: 'Tunnel stopped successfully'
        });
    } catch (error) {
        console.error('Tunnel stop error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to stop tunnel'
            },
            { status: 500 }
        );
    }
}
