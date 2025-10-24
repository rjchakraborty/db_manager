import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_RDS_TUNNEL } from '@/lib/tunnel-manager';

export async function GET(request: NextRequest) {
    try {
        return NextResponse.json({
            success: true,
            config: {
                id: 'default-rds-tunnel',
                ...DEFAULT_RDS_TUNNEL
            }
        });
    } catch (error) {
        console.error('Tunnel config error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to parse tunnel configuration from rds_tunnel.sh'
            },
            { status: 500 }
        );
    }
}
