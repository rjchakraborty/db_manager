import { spawn, ChildProcess, execSync } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync } from "fs";

export interface TunnelConfig {
  id: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sshHost: string;
  sshUser: string;
  privateKey?: string; // Optional for backward compatibility
  keyFile?: string; // Path to SSH key file
  password?: string; // SSH password for authentication
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
    process.on("exit", () => this.cleanup());
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
  }

  static getInstance(): TunnelManager {
    if (!TunnelManager.instance) {
      TunnelManager.instance = new TunnelManager();
    }
    return TunnelManager.instance;
  }

  async startRDSTunnel(): Promise<TunnelStatus> {
    const id = "default-rds-tunnel";
    const localPort = 5432;

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
      const sshKeyPath = "/Users/rj/.ssh/rds_tunnel_piston";

      // Check if SSH key exists
      try {
        await fs.access(sshKeyPath);
      } catch {
        throw new Error(`SSH key not found at ${sshKeyPath}`);
      }

      // Set correct permissions on key file
      await fs.chmod(sshKeyPath, 0o600);

      // Use the external script that handles terminal interaction properly
      const scriptPath = join(process.cwd(), "start-tunnel.sh");
      console.log(`🚀 Starting SSH tunnel using script: ${scriptPath}`);

      // Start SSH tunnel using the shell script
      const tunnelProcess = spawn("bash", [scriptPath], {
        stdio: ["inherit", "pipe", "pipe"], // Inherit stdin for password prompts, pipe stdout/stderr for monitoring
        detached: false, // Keep attached so password prompts work in terminal
      });

      console.log(
        `📝 SSH tunnel process started with PID: ${tunnelProcess.pid}`
      );

      // Store the process
      this.tunnels.set(id, tunnelProcess);

      const status: TunnelStatus = {
        id,
        isActive: false,
        localPort,
        pid: tunnelProcess.pid,
        startedAt: new Date(),
      };

      let processCompleted = false;

      // Handle process events
      tunnelProcess.on("error", (error) => {
        console.error(`RDS tunnel error for ${id}:`, error);
        status.isActive = false;
        status.error = error.message;
        this.statuses.set(id, status);
        this.cleanup(id);
      });

      tunnelProcess.on("exit", async (code, signal) => {
        console.log(
          `RDS tunnel expect process ${id} exited with code ${code}, signal ${signal}`
        );
        processCompleted = true;

        if (code === 1) {
          status.isActive = false;
          status.error = "Authentication failed - incorrect passphrase";
          this.statuses.set(id, status);
        } else if (code === 2) {
          status.isActive = false;
          status.error = "Connection refused - check network connectivity";
          this.statuses.set(id, status);
        } else if (code === 3) {
          status.isActive = false;
          status.error = "Connection timeout - check network and host";
          this.statuses.set(id, status);
        }
        // Don't set success status here, let the port check determine it
      });

      // Capture output for debugging
      tunnelProcess.stdout?.on("data", (data) => {
        const message = data.toString();
        console.log(`RDS tunnel ${id} expect stdout:`, message);
      });

      tunnelProcess.stderr?.on("data", (data) => {
        const message = data.toString();
        console.log(`RDS tunnel ${id} expect stderr:`, message);
      });

      // Wait for the expect process to complete and tunnel to establish
      const maxWaitTime = 15000; // 15 seconds
      const checkInterval = 1000; // 1 second
      let waited = 0;

      while (waited < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        waited += checkInterval;

        // Check if tunnel is active
        const isPortActive = await this.checkPortListening(localPort);
        if (isPortActive) {
          status.isActive = true;
          status.error = undefined;
          this.statuses.set(id, status);
          return status;
        }

        // If expect process completed with error, break early
        if (processCompleted && status.error) {
          break;
        }
      }

      // Final check if we timed out
      if (!status.isActive && !status.error) {
        status.error =
          "Tunnel connection timeout - please verify your passphrase and network connectivity";
      }

      this.statuses.set(id, status);
      return status;
    } catch (error) {
      const status: TunnelStatus = {
        id,
        isActive: false,
        localPort,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      this.statuses.set(id, status);
      return status;
    }
  }

  async startTunnel(config: TunnelConfig): Promise<TunnelStatus> {
    const {
      id,
      localPort,
      remoteHost,
      remotePort,
      sshHost,
      sshUser,
      privateKey,
    } = config;

    // For the default RDS tunnel, use the specialized RDS tunnel method
    if (id === "default-rds-tunnel") {
      return this.startRDSTunnel();
    }

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
      let sshKeyFile: string;

      if (privateKey) {
        // Create temporary key file from provided privateKey
        sshKeyFile = await this.createTempKeyFile(privateKey);
        this.keyFiles.set(id, sshKeyFile);
        // Set correct permissions on key file
        await fs.chmod(sshKeyFile, 0o600);
      } else {
        throw new Error(
          "privateKey is required for generic tunnel configuration"
        );
      }

      // Start SSH tunnel
      const sshProcess = spawn(
        "ssh",
        [
          "-i",
          sshKeyFile,
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=/dev/null",
          "-o",
          "ServerAliveInterval=60",
          "-o",
          "ServerAliveCountMax=3",
          "-N", // Don't execute remote command
          "-L",
          `${localPort}:${remoteHost}:${remotePort}`,
          `${sshUser}@${sshHost}`,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      // Store the process
      this.tunnels.set(id, sshProcess);

      const status: TunnelStatus = {
        id,
        isActive: false,
        localPort,
        pid: sshProcess.pid,
        startedAt: new Date(),
      };

      // Handle process events
      sshProcess.on("error", (error) => {
        console.error(`SSH tunnel error for ${id}:`, error);
        status.isActive = false;
        status.error = error.message;
        this.statuses.set(id, status);
        this.cleanup(id);
      });

      sshProcess.on("exit", (code, signal) => {
        console.log(
          `SSH tunnel ${id} exited with code ${code}, signal ${signal}`
        );
        status.isActive = false;
        if (code !== 0) {
          status.error = `Process exited with code ${code}`;
        }
        this.statuses.set(id, status);
        this.cleanup(id);
      });

      // Capture stderr for debugging
      sshProcess.stderr?.on("data", (data) => {
        const message = data.toString();
        console.log(`SSH tunnel ${id} stderr:`, message);

        // Check for common error patterns
        if (
          message.includes("Permission denied") ||
          message.includes("Connection refused") ||
          message.includes("Host key verification failed")
        ) {
          status.error = message.trim();
          this.statuses.set(id, status);
        }
      });

      // Wait longer for the tunnel to establish successfully
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Check if the process is still alive and port is listening
      if (this.isProcessAlive(sshProcess)) {
        // Try multiple times to check if port is listening
        let isPortListening = false;
        for (let i = 0; i < 3; i++) {
          isPortListening = await this.checkPortListening(localPort);
          if (isPortListening) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (isPortListening) {
          status.isActive = true;
          status.error = undefined;
        } else {
          status.error = "Tunnel process started but port is not listening";
        }
      } else {
        status.error = "SSH process died immediately";
      }

      this.statuses.set(id, status);
      return status;
    } catch (error) {
      const status: TunnelStatus = {
        id,
        isActive: false,
        localPort,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      this.statuses.set(id, status);
      this.cleanup(id);
      return status;
    }
  }

  async stopTunnel(id: string): Promise<void> {
    const process = this.tunnels.get(id);
    if (process && this.isProcessAlive(process)) {
      process.kill("SIGTERM");

      // Wait a moment for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Force kill if still alive
      if (this.isProcessAlive(process)) {
        process.kill("SIGKILL");
      }
    } else {
      // Check for external tunnel and kill it
      const externalTunnel = this.detectExternalTunnel(id);
      if (externalTunnel && externalTunnel.pid) {
        try {
          // Try graceful termination first
          execSync(`kill -TERM ${externalTunnel.pid}`, { timeout: 5000 });
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Check if still alive and force kill
          try {
            execSync(`kill -0 ${externalTunnel.pid}`, { timeout: 1000 }); // Check if process exists
            execSync(`kill -KILL ${externalTunnel.pid}`, { timeout: 5000 });
          } catch {
            // Process already dead or doesn't exist
          }
        } catch (error) {
          console.warn(
            `Failed to kill external tunnel process ${externalTunnel.pid}:`,
            error
          );
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
    if (id === "default-rds-tunnel") {
      try {
        const output = execSync("lsof -i :5432", {
          encoding: "utf8",
          timeout: 5000,
        });
        const lines = output.trim().split("\n");

        // Look for SSH processes
        const sshProcess = lines.find(
          (line: string) => line.includes("ssh") && line.includes("LISTEN")
        );
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
      } catch {
        // Ignore errors, just return null - tunnel may not be running
      }
    }
    return null;
  }

  getAllTunnelStatuses(): TunnelStatus[] {
    const statuses = Array.from(this.statuses.values());

    // Also check for external tunnels that might not be tracked
    const externalTunnel = this.detectExternalTunnel("default-rds-tunnel");
    if (
      externalTunnel &&
      !statuses.find((s) => s.id === "default-rds-tunnel")
    ) {
      statuses.push(externalTunnel);
    }

    return statuses;
  }

  private async createTempKeyFile(privateKey: string): Promise<string> {
    const tempDir = tmpdir();
    const keyFile = join(
      tempDir,
      `ssh_key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    );
    await fs.writeFile(keyFile, privateKey, { mode: 0o600 });
    return keyFile;
  }

  private isProcessAlive(process: ChildProcess): boolean {
    try {
      return (
        process.pid !== undefined &&
        !process.killed &&
        process.exitCode === null
      );
    } catch {
      return false;
    }
  }

  private async killProcessOnPort(port: number): Promise<void> {
    try {
      // Use lsof to find processes using the port
      const lsof = spawn("lsof", ["-ti", `:${port}`]);
      let pids = "";

      lsof.stdout.on("data", (data: Buffer) => {
        pids += data.toString();
      });

      await new Promise<void>((resolve) => {
        lsof.on("close", (code: number | null) => {
          if (code === 0 && pids.trim()) {
            // Kill the processes
            const pidList = pids
              .trim()
              .split("\n")
              .filter((pid) => pid.trim());
            pidList.forEach((pid) => {
              try {
                process.kill(parseInt(pid.trim()), "SIGTERM");
              } catch (error) {
                console.warn(`Failed to kill process ${pid}:`, error);
              }
            });
          }
          resolve();
        });
      });

      // Wait a moment for processes to die
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn("Error killing processes on port:", error);
    }
  }

  private async checkPortListening(port: number): Promise<boolean> {
    try {
      const lsof = spawn("lsof", ["-i", `:${port}`]);

      return new Promise<boolean>((resolve) => {
        let output = "";

        lsof.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        lsof.on("close", (code: number | null) => {
          // Check if we have actual listening processes (not just header)
          const lines = output
            .trim()
            .split("\n")
            .filter((line) => line.trim());
          const hasListeningProcess = lines.length > 1; // More than just the header
          resolve(code === 0 && hasListeningProcess);
        });

        lsof.on("error", () => {
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
        process.kill("SIGKILL");
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
      for (const [, process] of this.tunnels.entries()) {
        if (this.isProcessAlive(process)) {
          process.kill("SIGKILL");
        }
      }
      this.tunnels.clear();

      // Clean up all temp key files
      for (const [, keyFile] of this.keyFiles.entries()) {
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
function parseTunnelConfigFromScript(): Omit<TunnelConfig, "id"> {
  try {
    const scriptPath = join(process.cwd(), "rds_tunnel.sh");
    const scriptContent = readFileSync(scriptPath, "utf-8");

    // Extract SSH command line to parse configuration
    const sshCommandMatch = scriptContent.match(
      /ssh\s+.*?-L\s+(\d+):([^:]+):(\d+)\s+([^@]+)@([^\s]+)/
    );

    if (!sshCommandMatch) {
      throw new Error("Could not parse SSH command from script");
    }

    const [, localPort, remoteHost, remotePort, sshUser, sshHost] =
      sshCommandMatch;

    // Extract SSH key path from the script
    const keyPathMatch = scriptContent.match(/SSH_KEY_PATH="([^"]+)"/);

    if (!keyPathMatch) {
      throw new Error("Could not extract SSH key path from script");
    }

    const sshKeyPath = keyPathMatch[1];

    // Read the SSH key file
    let privateKey = "";
    try {
      privateKey = readFileSync(sshKeyPath, "utf-8");
    } catch (error) {
      throw new Error(`Could not read SSH key from ${sshKeyPath}: ${error}`);
    }

    return {
      name: "PistonPay Production RDS",
      localPort: parseInt(localPort),
      remoteHost,
      remotePort: parseInt(remotePort),
      sshHost,
      sshUser,
      privateKey,
      isActive: false,
    };
  } catch (error) {
    console.error("Failed to parse tunnel config from script:", error);
    throw new Error(
      "Could not load tunnel configuration from rds_tunnel.sh. Please ensure the script file exists and the SSH key is available."
    );
  }
}

// Default RDS tunnel configuration parsed from script
export const DEFAULT_RDS_TUNNEL: Omit<TunnelConfig, "id"> =
  parseTunnelConfigFromScript();

export const tunnelManager = TunnelManager.getInstance();
