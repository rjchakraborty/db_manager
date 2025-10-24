import { NextRequest, NextResponse } from 'next/server';
import { tunnelManager, TunnelConfig } from '@/lib/tunnel-manager';

export async function POST(request: NextRequest) {
    try {
        const config: TunnelConfig = await request.json();

        if (!config.id || !config.name || !config.localPort || !config.remoteHost || !config.sshHost) {
            return NextResponse.json(
                { success: false, error: 'Missing required tunnel configuration' },
                { status: 400 }
            );
        }

        const status = await tunnelManager.startTunnel(config);

        return NextResponse.json({
            success: status.isActive,
            status,
            error: status.error
        });
    } catch (error) {
        console.error('Tunnel start error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to start tunnel'
            },
            { status: 500 }
        );
    }
}
