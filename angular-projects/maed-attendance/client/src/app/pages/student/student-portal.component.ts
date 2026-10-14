import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { LOCATION_LABEL, LOCATION_TONE, STATUS_TONE, titleCase, to12h } from '../../core/format';
import { LocationResult, StudentDashboard } from '../../core/models';
import { poll } from '../../core/polling';
import { ToastService } from '../../core/toast.service';
import { AvatarComponent } from '../../shared/avatar.component';
import { DonutChartComponent } from '../../shared/donut-chart.component';
import { ExcuseFormComponent } from '../../shared/excuse-form.component';
import { GeoMapComponent, MapMarker } from '../../shared/geo-map.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

// Minimum time between automatic GPS pings while live tracking is on.
const LIVE_PING_MS = 30_000;

@Component({
  selector: 'app-student-portal',
  imports: [
    DatePipe,
    FormsModule,
    AvatarComponent,
    DonutChartComponent,
    ExcuseFormComponent,
    GeoMapComponent,
    IconComponent,
    ModalComponent,
  ],
  templateUrl: './student-portal.component.html',
  styleUrl: './student-portal.component.scss',
})
export class StudentPortalComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  protected readonly data = signal<StudentDashboard | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly lastPing = signal<LocationResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly liveTracking = signal(false);
  protected readonly excuseOpen = signal(false);
  protected simRoom = '';

  protected readonly LOCATION_LABEL = LOCATION_LABEL;
  protected readonly LOCATION_TONE = LOCATION_TONE;
  protected readonly STATUS_TONE = STATUS_TONE;
  protected readonly titleCase = titleCase;
  protected readonly to12h = to12h;

  private watchId: number | null = null;
  private lastLivePing = 0;

  protected readonly onCampus = computed(() => this.data()?.student.location !== 'OFF_CAMPUS');

  protected readonly marker = computed<MapMarker | null>(() => {
    const s = this.data()?.student;
    if (!s || s.lastLat == null || s.lastLng == null) return null;
    return {
      lat: s.lastLat,
      lng: s.lastLng,
      label: `${s.firstName} ${s.lastName}`,
      hue: s.avatarHue,
      initials: (s.firstName[0] + s.lastName[0]).toUpperCase(),
    };
  });

  constructor() {
    poll(() => this.load(), 20_000);
    inject(DestroyRef).onDestroy(() => this.stopLiveTracking());
  }

  protected load() {
    this.api.studentDashboard().subscribe({
      next: (d) => {
        this.data.set(d);
        this.error.set(null);
        if (!this.simRoom) this.simRoom = d.currentClass?.room ?? d.rooms[0] ?? '';
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  /** Demo helper: send a position just inside the geofence (optionally in a room). */
  protected simulateArrival() {
    const f = this.data()?.geofence;
    if (!f) return;
    this.ping(f.centerLat + 0.0004, f.centerLng - 0.0003, this.simRoom || null);
  }

  protected simulateCampusOnly() {
    const f = this.data()?.geofence;
    if (!f) return;
    this.ping(f.centerLat - 0.0005, f.centerLng + 0.0004, null);
  }

  /** Demo helper: send a position ~1.1 km outside the geofence. */
  protected simulateLeave() {
    const f = this.data()?.geofence;
    if (!f) return;
    this.ping(f.centerLat + 0.01, f.centerLng + 0.004, null);
  }

  protected useGps() {
    if (!('geolocation' in navigator)) {
      this.toast.error('This browser does not support location services.');
      return;
    }
    this.busy.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => this.ping(pos.coords.latitude, pos.coords.longitude, null),
      (err) => {
        this.busy.set(false);
        this.toast.error(`Could not read your location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  protected toggleLiveTracking() {
    if (this.liveTracking()) {
      this.stopLiveTracking();
      return;
    }
    if (!('geolocation' in navigator)) {
      this.toast.error('This browser does not support location services.');
      return;
    }
    this.liveTracking.set(true);
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - this.lastLivePing < LIVE_PING_MS) return;
        this.lastLivePing = Date.now();
        this.ping(pos.coords.latitude, pos.coords.longitude, null, true);
      },
      (err) => {
        this.toast.error(`Live tracking stopped: ${err.message}`);
        this.stopLiveTracking();
      },
      { enableHighAccuracy: true },
    );
  }

  private stopLiveTracking() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.liveTracking.set(false);
  }

  private ping(lat: number, lng: number, room: string | null, quiet = false) {
    this.busy.set(true);
    this.api.sendLocation(lat, lng, room).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.lastPing.set(res);
        if (res.event === 'ENTRY') this.toast.success('Automated check-in successful — welcome to campus!');
        if (res.event === 'EXIT') this.toast.show('Exit logged. You have left the school premises.', 'warning');
        if (res.autoMarked) this.toast.success(`${res.autoMarked.subject}: marked ${titleCase(res.autoMarked.status)}`);
        if (!quiet && !res.event && !res.autoMarked) this.toast.show(res.inside ? 'Location updated (inside geofence).' : `You are ${res.distance} m from school.`);
        this.load();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  protected onExcuseSubmitted() {
    this.excuseOpen.set(false);
    this.load();
  }
}
