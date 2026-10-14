import { AfterViewInit, Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Geofence } from '../core/models';

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  hue: number;
  initials: string;
}

/** Leaflet map showing the school geofence and (optionally) a person's last known position. */
@Component({
  selector: 'app-geo-map',
  template: `<div #host class="map"></div>
    <span class="tag"><span class="ring"></span>School premises</span>`,
  styles: `
    :host { position: relative; display: block; border-radius: var(--radius); overflow: hidden; min-height: 220px;
      border: 1px solid var(--glass-border); box-shadow: var(--glass-shadow); }
    .map { position: absolute; inset: 0; }
    .tag { position: absolute; top: 10px; right: 10px; z-index: 500; display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      background: var(--glass-strong); backdrop-filter: var(--blur); color: var(--text); }
    .ring { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--success); background: var(--success-soft); }
  `,
})
export class GeoMapComponent implements AfterViewInit, OnDestroy {
  readonly geofence = input.required<Geofence>();
  readonly marker = input<MapMarker | null>(null);
  readonly inside = input(false);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private map?: L.Map;
  private circle?: L.Circle;
  private pin?: L.Marker;
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => this.render(this.geofence(), this.marker(), this.inside()));
  }

  ngAfterViewInit() {
    const fence = this.geofence();
    this.map = L.map(this.host().nativeElement, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView([fence.centerLat, fence.centerLng], 16);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Leaflet needs a size recalculation when its container resizes (grid reflow).
    this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObserver.observe(this.host().nativeElement);

    this.render(fence, this.marker(), this.inside());
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  private render(fence: Geofence, marker: MapMarker | null, inside: boolean) {
    if (!this.map) return;
    const color = inside ? '#16a34a' : '#2563eb';

    this.circle?.remove();
    this.circle = L.circle([fence.centerLat, fence.centerLng], {
      radius: fence.radiusMeters,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.14,
    }).addTo(this.map);

    this.pin?.remove();
    if (marker) {
      const icon = L.divIcon({
        className: '',
        iconSize: [44, 52],
        iconAnchor: [22, 50],
        html: `<div style="position:relative;width:44px;height:52px">
          <div style="width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 15px/1 Inter,system-ui;
            background:linear-gradient(135deg,hsl(${marker.hue} 70% 55%),hsl(${(marker.hue + 35) % 360} 75% 45%));
            border:3px solid #fff;box-shadow:0 6px 16px rgba(15,30,61,.35)">${marker.initials}</div>
          <div style="position:absolute;left:50%;bottom:0;width:12px;height:12px;transform:translateX(-50%) rotate(45deg);background:#fff;z-index:-1"></div>
        </div>`,
      });
      this.pin = L.marker([marker.lat, marker.lng], { icon, title: marker.label }).addTo(this.map);
      this.map.fitBounds(this.circle.getBounds().extend([marker.lat, marker.lng]), { padding: [30, 30], maxZoom: 17 });
    } else {
      this.map.fitBounds(this.circle.getBounds(), { padding: [20, 20] });
    }
  }
}
