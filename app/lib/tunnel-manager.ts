import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

export interface TunnelConfig {
    id: string;
    name: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
    sshHost: string;
    sshUser: string;
    privateKey: string;
    isActive: boolean;
}

export interface TunnelStatus {
    id: string;
    isActive: boolean;
    localPort: number;
    pid?: number;
    error?: string;
    startedAt?: Date;
}

class TunnelManager {
    private static instance: TunnelManager;
    private tunnels = new Map<string, ChildProcess>();
    private statuses = new Map<string, TunnelStatus>();
    private keyFiles = new Map<string, string>(); // Track temp key files

    private constructor() {
        // Cleanup on process exit
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }

    static getInstance(): TunnelManager {
        if (!TunnelManager.instance) {
            TunnelManager.instance = new TunnelManager();
        }
        return TunnelManager.instance;
    }

    async startTunnel(config: TunnelConfig): Promise<TunnelStatus> {
        const { id, localPort, remoteHost, remotePort, sshHost, sshUser, privateKey } = config;

        // Check if tunnel is already running
        if (this.tunnels.has(id) && this.isProcessAlive(this.tunnels.get(id)!)) {
            const status = this.statuses.get(id);
            if (status) {
                return status;
            }
        }

        // Kill any existing process using the local port
        await this.killProcessOnPort(localPort);

        try {
            // Create temporary key file
            const keyFile = await this.createTempKeyFile(privateKey);
            this.keyFiles.set(id, keyFile);

            // Set correct permissions on key file
            await fs.chmod(keyFile, 0o600);

            // Start SSH tunnel
            const sshProcess = spawn('ssh', [
                '-i', keyFile,
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'UserKnownHostsFile=/dev/null',
                '-o', 'ServerAliveInterval=60',
                '-o', 'ServerAliveCountMax=3',
                '-N', // Don't execute remote command
                '-L', `${localPort}:${remoteHost}:${remotePort}`,
                `${sshUser}@${sshHost}`
            ], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            // Store the process
            this.tunnels.set(id, sshProcess);

            const status: TunnelStatus = {
                id,
                isActive: false,
                localPort,
                pid: sshProcess.pid,
                startedAt: new Date()
            };

            // Handle process events
            sshProcess.on('error', (error) => {
                console.error(`SSH tunnel error for ${id}:`, error);
                status.isActive = false;
                status.error = error.message;
                this.statuses.set(id, status);
                this.cleanup(id);
            });

            sshProcess.on('exit', (code, signal) => {
                console.log(`SSH tunnel ${id} exited with code ${code}, signal ${signal}`);
                status.isActive = false;
                if (code !== 0) {
                    status.error = `Process exited with code ${code}`;
                }
                this.statuses.set(id, status);
                this.cleanup(id);
            });

            // Capture stderr for debugging
            sshProcess.stderr?.on('data', (data) => {
                const message = data.toString();
                console.log(`SSH tunnel ${id} stderr:`, message);

                // Check for common error patterns
                if (message.includes('Permission denied') ||
                    message.includes('Connection refused') ||
                    message.includes('Host key verification failed')) {
                    status.error = message.trim();
                    this.statuses.set(id, status);
                }
            });

            // Wait longer for the tunnel to establish successfully
            await new Promise(resolve => setTimeout(resolve, 4000));

            // Check if the process is still alive and port is listening
            if (this.isProcessAlive(sshProcess)) {
                // Try multiple times to check if port is listening
                let isPortListening = false;
                for (let i = 0; i < 3; i++) {
                    isPortListening = await this.checkPortListening(localPort);
                    if (isPortListening) break;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (isPortListening) {
                    status.isActive = true;
                    status.error = undefined;
                } else {
                    status.error = 'Tunnel process started but port is not listening';
                }
            } else {
                status.error = 'SSH process died immediately';
            }

            this.statuses.set(id, status);
            return status;

        } catch (error) {
            const status: TunnelStatus = {
                id,
                isActive: false,
                localPort,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
            this.statuses.set(id, status);
            this.cleanup(id);
            return status;
        }
    }

    async stopTunnel(id: string): Promise<void> {
        const process = this.tunnels.get(id);
        if (process && this.isProcessAlive(process)) {
            process.kill('SIGTERM');

            // Wait a moment for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Force kill if still alive
            if (this.isProcessAlive(process)) {
                process.kill('SIGKILL');
            }
        } else {
            // Check for external tunnel and kill it
            const externalTunnel = this.detectExternalTunnel(id);
            if (externalTunnel && externalTunnel.pid) {
                try {
                    const { execSync } = require('child_process');

                    // Try graceful termination first
                    execSync(`kill -TERM ${externalTunnel.pid}`, { timeout: 5000 });
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Check if still alive and force kill
                    try {
                        execSync(`kill -0 ${externalTunnel.pid}`, { timeout: 1000 }); // Check if process exists
                        execSync(`kill -KILL ${externalTunnel.pid}`, { timeout: 5000 });
                    } catch {
                        // Process already dead or doesn't exist
                    }
                } catch (error) {
                    console.warn(`Failed to kill external tunnel process ${externalTunnel.pid}:`, error);
                }
            }
        }

        this.cleanup(id);

        const status = this.statuses.get(id);
        if (status) {
            status.isActive = false;
            this.statuses.set(id, status);
        }
    }

    getTunnelStatus(id: string): TunnelStatus | null {
        const status = this.statuses.get(id);
        if (!status) {
            // Check if there's an external SSH tunnel running for this ID
            return this.detectExternalTunnel(id);
        }

        // Update active status based on process state
        const process = this.tunnels.get(id);
        if (process && !this.isProcessAlive(process)) {
            status.isActive = false;
            this.statuses.set(id, status);
        }

        return status;
    }

    private detectExternalTunnel(id: string): TunnelStatus | null {
        // For the default RDS tunnel, check if port 5432 is in use by SSH
        if (id === 'default-rds-tunnel') {
            try {
                const { execSync } = require('child_process');
                const output = execSync('lsof -i :5432', { encoding: 'utf8', timeout: 5000 });
                const lines = output.trim().split('\n');

                // Look for SSH processes
                const sshProcess = lines.find((line: string) => line.includes('ssh') && line.includes('LISTEN'));
                if (sshProcess) {
                    const pidMatch = sshProcess.match(/ssh\s+(\d+)/);
                    const pid = pidMatch ? parseInt(pidMatch[1]) : undefined;

                    return {
                        id,
                        isActive: true,
                        localPort: 5432,
                        pid,
                        startedAt: new Date(), // We don't know the actual start time
                    };
                }
            } catch (error) {
                // Ignore errors, just return null
            }
        }
        return null;
    }

    getAllTunnelStatuses(): TunnelStatus[] {
        const statuses = Array.from(this.statuses.values());

        // Also check for external tunnels that might not be tracked
        const externalTunnel = this.detectExternalTunnel('default-rds-tunnel');
        if (externalTunnel && !statuses.find(s => s.id === 'default-rds-tunnel')) {
            statuses.push(externalTunnel);
        }

        return statuses;
    }

    private async createTempKeyFile(privateKey: string): Promise<string> {
        const tempDir = tmpdir();
        const keyFile = join(tempDir, `ssh_key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
        await fs.writeFile(keyFile, privateKey, { mode: 0o600 });
        return keyFile;
    }

    private isProcessAlive(process: ChildProcess): boolean {
        try {
            return process.pid !== undefined && !process.killed && process.exitCode === null;
        } catch {
            return false;
        }
    }

    private async killProcessOnPort(port: number): Promise<void> {
        try {
            const { spawn } = require('child_process');

            // Use lsof to find processes using the port
            const lsof = spawn('lsof', ['-ti', `:${port}`]);
            let pids = '';

            lsof.stdout.on('data', (data: Buffer) => {
                pids += data.toString();
            });

            await new Promise<void>((resolve) => {
                lsof.on('close', (code: number | null) => {
                    if (code === 0 && pids.trim()) {
                        // Kill the processes
                        const pidList = pids.trim().split('\n').filter(pid => pid.trim());
                        pidList.forEach(pid => {
                            try {
                                process.kill(parseInt(pid.trim()), 'SIGTERM');
                            } catch (error) {
                                console.warn(`Failed to kill process ${pid}:`, error);
                            }
                        });
                    }
                    resolve();
                });
            });

            // Wait a moment for processes to die
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.warn('Error killing processes on port:', error);
        }
    }

    private async checkPortListening(port: number): Promise<boolean> {
        try {
            const { spawn } = require('child_process');
            const lsof = spawn('lsof', ['-i', `:${port}`]);

            return new Promise<boolean>((resolve) => {
                let output = '';

                lsof.stdout.on('data', (data: Buffer) => {
                    output += data.toString();
                });

                lsof.on('close', (code: number | null) => {
                    // Check if we have actual listening processes (not just header)
                    const lines = output.trim().split('\n').filter(line => line.trim());
                    const hasListeningProcess = lines.length > 1; // More than just the header
                    resolve(code === 0 && hasListeningProcess);
                });

                lsof.on('error', () => {
                    resolve(false);
                });

                // Timeout after 3 seconds
                setTimeout(() => {
                    lsof.kill();
                    resolve(false);
                }, 3000);
            });
        } catch {
            return false;
        }
    }

    private async cleanup(id?: string): Promise<void> {
        if (id) {
            // Cleanup specific tunnel
            const process = this.tunnels.get(id);
            if (process && this.isProcessAlive(process)) {
                process.kill('SIGKILL');
            }
            this.tunnels.delete(id);

            // Clean up temp key file
            const keyFile = this.keyFiles.get(id);
            if (keyFile) {
                try {
                    await fs.unlink(keyFile);
                } catch (error) {
                    console.warn(`Failed to delete temp key file ${keyFile}:`, error);
                }
                this.keyFiles.delete(id);
            }
        } else {
            // Cleanup all tunnels
            for (const [tunnelId, process] of this.tunnels.entries()) {
                if (this.isProcessAlive(process)) {
                    process.kill('SIGKILL');
                }
            }
            this.tunnels.clear();

            // Clean up all temp key files
            for (const [tunnelId, keyFile] of this.keyFiles.entries()) {
                try {
                    await fs.unlink(keyFile);
                } catch (error) {
                    console.warn(`Failed to delete temp key file ${keyFile}:`, error);
                }
            }
            this.keyFiles.clear();
        }
    }
}

// Function to parse tunnel configuration from rds_tunnel.sh
function parseTunnelConfigFromScript(): Omit<TunnelConfig, 'id'> {
    try {
        const scriptPath = join(process.cwd(), 'rds_tunnel.sh');
        const scriptContent = readFileSync(scriptPath, 'utf-8');

        // Extract SSH command line to parse configuration
        const sshCommandMatch = scriptContent.match(/ssh\s+.*?-L\s+(\d+):([^:]+):(\d+)\s+([^@]+)@([^\s]+)/);

        if (!sshCommandMatch) {
            throw new Error('Could not parse SSH command from script');
        }

        const [, localPort, remoteHost, remotePort, sshUser, sshHost] = sshCommandMatch;

        // Extract private key from the script
        const keyStartMatch = scriptContent.match(/-----BEGIN RSA PRIVATE KEY-----/);
        const keyEndMatch = scriptContent.match(/-----END RSA PRIVATE KEY-----/);

        if (!keyStartMatch || !keyEndMatch) {
            throw new Error('Could not extract private key from script');
        }

        const keyStart = keyStartMatch.index!;
        const keyEnd = keyEndMatch.index! + keyEndMatch[0].length;
        const privateKey = scriptContent.substring(keyStart, keyEnd);

        return {
            name: 'PistonPay Production RDS',
            localPort: parseInt(localPort),
            remoteHost,
            remotePort: parseInt(remotePort),
            sshHost,
            sshUser,
            privateKey,
            isActive: false
        };
    } catch (error) {
        console.error('Failed to parse tunnel config from script:', error);
        throw new Error('Could not load tunnel configuration from rds_tunnel.sh. Please ensure the script file exists and is properly formatted.');
    }
}

// Default RDS tunnel configuration parsed from script
export const DEFAULT_RDS_TUNNEL: Omit<TunnelConfig, 'id'> = parseTunnelConfigFromScript();

export const tunnelManager = TunnelManager.getInstance();
