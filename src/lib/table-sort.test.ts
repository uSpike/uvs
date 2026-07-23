import { describe, expect, it } from 'vitest';
import {
  compareTableSortValues,
  initialTableSortDirection,
} from './table-sort';

describe('sortable table helpers', () => {
  it('uses natural ascending text and descending numeric defaults', () => {
    expect(initialTableSortDirection('text')).toBe('ascending');
    expect(initialTableSortDirection('number')).toBe('descending');
  });

  it('sorts text and numbers while leaving unavailable values last', () => {
    expect(['Line 10', 'Line 2'].sort((left, right) =>
      compareTableSortValues(left, right, 'ascending')
    )).toEqual(['Line 2', 'Line 10']);
    expect([2, 9, 4].sort((left, right) =>
      compareTableSortValues(left, right, 'descending')
    )).toEqual([9, 4, 2]);
    expect([null, 2, 9].sort((left, right) =>
      compareTableSortValues(left, right, 'ascending')
    )).toEqual([2, 9, null]);
    expect([null, 2, 9].sort((left, right) =>
      compareTableSortValues(left, right, 'descending')
    )).toEqual([9, 2, null]);
  });
});
