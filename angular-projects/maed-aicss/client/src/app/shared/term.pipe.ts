import { Pipe, PipeTransform } from '@angular/core';
import { termLabel } from '../core/format';

/** 1 -> "1st Term", 2 -> "2nd Term", 3 -> "3rd Term". */
@Pipe({ name: 'term' })
export class TermPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return termLabel(value);
  }
}
