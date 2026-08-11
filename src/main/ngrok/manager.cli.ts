// Ngrok Manager - CLI-based Implementation (BACKUP)
// This is a backup of the original CLI-based implementation before SDK migration
// Created: 2024 - Ngrok SDK Migration (Task 1.3)
// DO NOT USE - For reference and rollback purposes only

import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import axios from 'axios';

interface NgrokConfig {
  authToken?: string;
  enabled: boolean;
  port: number;
}

interface NgrokTunnel {
  publicUrl: string;
  proto: string;
  config: {
    addr: string;
  };
}

export class NgrokManager {
  private process: ChildProcess | null = null;
  private config: NgrokConfig;
  private publicUrl: string | null = null;
  private isRunning: boolean = false;

  constructor(config: NgrokConfig) {
    this.config = config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: NgrokConfig) {
    this.config = config;
  }

  /**
   * Get ngrok executable path
   */
  private getNgrokPath(): string {
    const platform = os.platform();
    const userHome = os.homedir();
    
    // Check common installation locations
    const possiblePaths = [
      path.join(userHome, 'ngrok', 'ngrok.exe'), // Windows - manual install
      path.join(userHome, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ngrok.exe'), // Windows - winget
      '/usr/local/bin/ngrok', // macOS/Linux
      '/usr/bin/ngrok', // Linux
    ];

    for (const ngrokPath of possiblePaths) {
      if (fs.existsSync(ngrokPath)) {
        return ngrokPath;
      }
    }

    // Fallback to system PATH
    return platform === 'win32' ? 'ngrok.exe' : 'ngrok';
  }

  /**
   * Configure ngrok with auth token
   */
  async configureAuthToken(authToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const ngrokPath = this.getNgrokPath();
      
      return new Promise((resolve) => {
        const configProcess = spawn(ngrokPath, ['config', 'add-authtoken', authToken]);
        
        let output = '';
        let errorOutput = '';

        configProcess.stdout?.on('data', (data) => {
          output += data.toString();
        });

        configProcess.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        configProcess.on('close', (code) => {
          if (code === 0) {
            this.config.authToken = authToken;
            resolve({ success: true, message: 'Token de autentificare salvat cu succes' });
          } else {
            resolve({ 
              success: false, 
              message: `Eroare la configurarea token-ului: ${errorOutput || 'Unknown error'}` 
            });
          }
        });

        configProcess.on('error', (error) => {
          resolve({ 
            success: false, 
            message: `Ngrok nu a fost găsit. Te rog instalează ngrok: ${error.message}` 
          });
        });
      });
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Kill all existing ngrok sessions
   */
  private async killExistingSessions(): Promise<void> {
    try {
      const ngrokPath = this.getNgrokPath();
      
      return new Promise((resolve) => {
        console.log('[Ngrok] Killing existing sessions...');
        const killProcess = spawn(ngrokPath, ['kill'], { shell: true });
        
        killProcess.on('close', (code) => {
          console.log(`[Ngrok] Kill command completed with code ${code}`);
          resolve();
        });

        killProcess.on('error', (error) => {
          console.log('[Ngrok] Kill command error (might be ok if no sessions):', error.message);
          resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
          killProcess.kill();
          resolve();
        }, 2000);
      });
    } catch (error) {
      console.log('[Ngrok] Failed to kill sessions:', error);
      // Continue anyway
    }
  }

  /**
   * Start ngrok tunnel
   */
  async start(): Promise<{ success: boolean; message: string; publicUrl?: string }> {
    if (this.isRunning) {
      return { success: true, message: 'Ngrok rulează deja', publicUrl: this.publicUrl || undefined };
    }

    if (!this.config.authToken) {
      return { success: false, message: 'Token de autentificare ngrok lipsește' };
    }

    try {
      // Kill any existing sessions first
      await this.killExistingSessions();
      
      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      const ngrokPath = this.getNgrokPath();
      const port = this.config.port || 3000; // Default to 3000 if not set
      
      console.log('[Ngrok] Ngrok path:', ngrokPath);
      console.log('[Ngrok] Starting with port:', port);
      
      // Use --region flag to force a new random URL instead of reserved domain
      const args = ['http', port.toString(), '--region', 'us'];
      console.log('[Ngrok] Command:', ngrokPath, args);
      
      // Start ngrok process with shell
      this.process = spawn(ngrokPath, args, {
        shell: true,
        windowsHide: false
      });

      let output = '';
      let errorOutput = '';

      this.process.stdout?.on('data', (data) => {
        output += data.toString();
        console.log('[Ngrok Output]', data.toString());
      });

      this.process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        console.error('[Ngrok Error]', data.toString());
      });

      this.process.on('close', (code) => {
        console.log(`[Ngrok] Process exited with code ${code}`);
        console.log(`[Ngrok] Last output:`, output);
        console.log(`[Ngrok] Last error:`, errorOutput);
        this.isRunning = false;
        this.publicUrl = null;
      });

      this.process.on('error', (error) => {
        console.error('[Ngrok] Process error:', error);
        this.isRunning = false;
        this.publicUrl = null;
      });

      // Wait for ngrok to start and get public URL
      await new Promise(resolve => setTimeout(resolve, 3000));

      const url = await this.getPublicUrl();
      
      if (url) {
        this.isRunning = true;
        this.publicUrl = url;
        return { success: true, message: 'Ngrok pornit cu succes', publicUrl: url };
      } else {
        this.stop();
        return { success: false, message: 'Nu s-a putut obține URL-ul public de la ngrok' };
      }

    } catch (error: any) {
      console.error('[Ngrok] Start error:', error);
      return { success: false, message: error?.message || 'Eroare necunoscută' };
    }
  }

  /**
   * Stop ngrok tunnel
   */
  stop(): { success: boolean; message: string } {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isRunning = false;
      this.publicUrl = null;
      return { success: true, message: 'Ngrok oprit' };
    }
    return { success: false, message: 'Ngrok nu rulează' };
  }

  /**
   * Get public URL from ngrok API
   */
  private async getPublicUrl(): Promise<string | null> {
    try {
      const response = await axios.get('http://127.0.0.1:4040/api/tunnels');
      const tunnels: NgrokTunnel[] = response.data.tunnels;
      
      // Find HTTPS tunnel
      const httpsTunnel = tunnels.find(t => t.proto === 'https');
      
      if (httpsTunnel) {
        return httpsTunnel.publicUrl;
      }
      
      return null;
    } catch (error) {
      console.error('[Ngrok] Failed to get public URL:', error);
      return null;
    }
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<{ 
    isRunning: boolean; 
    publicUrl: string | null; 
    webhookUrl: string | null;
    configured: boolean;
  }> {
    // If we think it's running, verify by checking the API
    if (this.isRunning) {
      const url = await this.getPublicUrl();
      if (!url) {
        // Ngrok stopped unexpectedly
        this.isRunning = false;
        this.publicUrl = null;
      } else {
        this.publicUrl = url;
      }
    }

    return {
      isRunning: this.isRunning,
      publicUrl: this.publicUrl,
      webhookUrl: this.publicUrl ? `${this.publicUrl}/webhook` : null,
      configured: !!this.config.authToken
    };
  }

  /**
   * Check if ngrok is installed
   */
  isInstalled(): boolean {
    try {
      const ngrokPath = this.getNgrokPath();
      return fs.existsSync(ngrokPath);
    } catch {
      return false;
    }
  }
}
