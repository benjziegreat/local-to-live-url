import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SubjectOption } from '../core/models';
import { SubjectFilterService } from '../core/subject-filter.service';
import { IconComponent } from './icon.component';

/**
 * Subject selector placed at the top of every module. All instances share
 * SubjectFilterService, so a choice made on one page applies everywhere.
 */
@Component({
  selector: 'app-subject-filter',
  imports: [FormsModule, IconComponent],
  template: `
    @if (filter.subjects().length) {
      <label class="subject-filter" [class.on]="filter.selectedId() !== null" title="Subject: records shown are for this subject only">
        <app-icon name="book" [size]="16" />
        <select [ngModel]="filter.selectedId()" (ngModelChange)="filter.select($event)" aria-label="Subject">
          @if (filter.allowAll()) {
            <option [ngValue]="null">All Subjects</option>
          }
          @for (g of groups(); track g.label) {
            <optgroup [label]="g.label">
              @for (s of g.list; track s.id) {
                <option [ngValue]="s.id">{{ s.name }}</option>
              }
            </optgroup>
          }
        </select>
      </label>
    }
  `,
  styles: `
    .subject-filter {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 0 4px 0 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      color: var(--text-2);
      max-width: 100%;
    }
    .subject-filter.on {
      border-color: var(--brand);
      color: var(--brand);
      background: color-mix(in srgb, var(--brand) 8%, var(--surface));
    }
    select {
      border: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-weight: 600;
      min-height: 38px;
      padding-right: 6px;
      max-width: min(320px, 70vw);
      text-overflow: ellipsis;
      cursor: pointer;
      outline: none;
    }
    select:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }
  `,
})
export class SubjectFilterComponent {
  protected readonly filter = inject(SubjectFilterService);

  /** Teachers: subjects they teach, then other subjects of their advisory section. Admins: by kind. */
  protected readonly groups = computed(() => {
    const list = this.filter.subjects();
    const out: { label: string; list: SubjectOption[] }[] = [];
    const add = (label: string, items: SubjectOption[]) => items.length && out.push({ label, list: items });
    if (list.some((s) => s.teaches)) {
      add('Subjects I teach', list.filter((s) => s.teaches));
      add('My advisory section', list.filter((s) => !s.teaches));
    } else {
      add('Core subjects', list.filter((s) => s.kind === 'CORE'));
      add('Electives', list.filter((s) => s.kind === 'ELECTIVE'));
      add('Programs', list.filter((s) => s.kind === 'PROGRAM'));
    }
    return out;
  });
}
