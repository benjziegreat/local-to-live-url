import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface TunnelState {
  status: TunnelStatus;
  localUrl: string | null;
  publicUrl: string | null;
  startedAt: string | null;
  error: string | null;
  logs: string[];
}

const API_BASE = '/api/tunnel';

@Injectable({ providedIn: 'root' })
export class TunnelService {
  constructor(private readonly http: HttpClient) {}

  getStatus(): Observable<TunnelState> {
    return this.http.get<TunnelState>(`${API_BASE}/status`);
  }

  start(localUrl: string): Observable<TunnelState> {
    return this.http.post<TunnelState>(`${API_BASE}/start`, { localUrl });
  }

  stop(): Observable<TunnelState> {
    return this.http.post<TunnelState>(`${API_BASE}/stop`, {});
  }
}
