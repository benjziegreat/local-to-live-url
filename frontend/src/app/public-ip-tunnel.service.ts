import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type SshTunnelStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface SshTunnelState {
  status: SshTunnelStatus;
  localUrl: string | null;
  publicUrl: string | null;
  startedAt: string | null;
  error: string | null;
  logs: string[];
}

export interface SshTunnelStartRequest {
  localUrl: string;
  publicIp: string;
  sshUser: string;
  sshPort?: number;
  remotePort: number;
  privateKeyPath?: string;
}

const API_BASE = '/api/ssh-tunnel';

@Injectable({ providedIn: 'root' })
export class PublicIpTunnelService {
  constructor(private readonly http: HttpClient) {}

  getStatus(): Observable<SshTunnelState> {
    return this.http.get<SshTunnelState>(`${API_BASE}/status`);
  }

  start(request: SshTunnelStartRequest): Observable<SshTunnelState> {
    return this.http.post<SshTunnelState>(`${API_BASE}/start`, request);
  }

  stop(): Observable<SshTunnelState> {
    return this.http.post<SshTunnelState>(`${API_BASE}/stop`, {});
  }
}
