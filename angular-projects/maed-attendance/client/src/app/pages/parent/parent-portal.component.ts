import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/auth.interceptor';
import { LOCATION_LABEL, LOCATION_TONE, titleCase, to12h } from '../../core/format';
import { ChildSummary, ParentDashboard } from '../../core/models';
import { poll } from '../../core/polling';
import { AvatarComponent } from '../../shared/avatar.component';
import { ChatComponent } from '../../shared/chat.component';
import { DonutChartComponent } from '../../shared/donut-chart.component';
import { ExcuseFormComponent } from '../../shared/excuse-form.component';
import { GeoMapComponent, MapMarker } from '../../shared/geo-map.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

@Component({
  selector: 'app-parent-portal',
  imports: [
    DatePipe,
    FormsModule,
    AvatarComponent,
    ChatComponent,
    DonutChartComponent,
    ExcuseFormComponent,
    GeoMapComponent,
    IconComponent,
    ModalComponent,
  ],
  templateUrl: './parent-portal.component.html',
  styleUrl: './parent-portal.component.scss',
})
export class ParentPortalComponent {
  private api = inject(ApiService);

  protected readonly children = signal<ChildSummary[]>([]);
  protected readonly childId = signal<number | null>(null);
  protected readonly data = signal<ParentDashboard | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly chatOpen = signal(false);
  protected readonly excuseOpen = signal(false);

  protected readonly LOCATION_LABEL = LOCATION_LABEL;
  protected readonly LOCATION_TONE = LOCATION_TONE;
  protected readonly titleCase = titleCase;
  protected readonly to12h = to12h;

  protected readonly onCampus = computed(() => this.data()?.child.location !== 'OFF_CAMPUS');

  protected readonly marker = computed<MapMarker | null>(() => {
    const d = this.data();
    if (!d) return null;
    const c = d.child;
    // Without a fix yet, show the child at school when on campus.
    const lat = c.lastLat ?? (this.onCampus() ? d.geofence.centerLat : null);
    const lng = c.lastLng ?? (this.onCampus() ? d.geofence.centerLng : null);
    if (lat == null || lng == null) return null;
    const [first, last] = [c.name.split(' ')[0], c.name.split(' ').at(-1) ?? ''];
    return { lat, lng, label: c.name, hue: c.avatarHue, initials: (first[0] + (last[0] ?? '')).toUpperCase() };
  });

  constructor() {
    this.api.children().subscribe({
      next: (list) => {
        this.children.set(list);
        if (list[0]) {
          this.childId.set(list[0].id);
          this.load();
        } else {
          this.error.set('No students are linked to your account yet. Please contact the school.');
        }
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
    poll(() => this.load(), 15_000);
  }

  protected selectChild(id: number) {
    this.childId.set(Number(id));
    this.data.set(null);
    this.load();
  }

  protected load() {
    const id = this.childId();
    if (!id) return;
    this.api.childDashboard(id).subscribe({
      next: (d) => {
        if (d.child.id === this.childId()) this.data.set(d);
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected closeChat() {
    this.chatOpen.set(false);
    this.load(); // refresh unread count / preview
  }

  protected onExcuseSubmitted() {
    this.excuseOpen.set(false);
    this.load();
  }
}
