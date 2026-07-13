import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type DnsTunnelStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface DnsTunnelState {
  id: number;
  status: DnsTunnelStatus;
  localUrl: string | null;
  publicUrl: string | null;
  startedAt: string | null;
  error: string | null;
  logs: string[];
}

export interface DnsTunnelStartRequest {
  localUrl: string;
  subdomain: string;
}

const API_BASE = '/api/dns-tunnel';

@Injectable({ providedIn: 'root' })
export class PublicIpTunnelService {
  constructor(private readonly http: HttpClient) {}

  getAllStatus(): Observable<DnsTunnelState[]> {
    return this.http.get<DnsTunnelState[]>(`${API_BASE}/status`);
  }

  start(id: number, request: DnsTunnelStartRequest): Observable<DnsTunnelState> {
    return this.http.post<DnsTunnelState>(`${API_BASE}/${id}/start`, request);
  }

  stop(id: number): Observable<DnsTunnelState> {
    return this.http.post<DnsTunnelState>(`${API_BASE}/${id}/stop`, {});
  }
}
