/** Direction exposed through an accessible sortable table header. */
export type TableSortDirection = 'ascending' | 'descending';

/** Primitive values supported by the shared table comparator. */
export type TableSortValue = string | number | null;

/** Pick the initial direction for a newly selected text or numeric column. */
export function initialTableSortDirection(
  kind: 'text' | 'number',
): TableSortDirection {
  return kind === 'text' ? 'ascending' : 'descending';
}

/**
 * Compare sortable table values while keeping unavailable values at the bottom
 * in either direction.
 */
export function compareTableSortValues(
  left: TableSortValue,
  right: TableSortValue,
  direction: TableSortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const comparison = typeof left === 'string' && typeof right === 'string'
    ? left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
    : Number(left) - Number(right);
  return direction === 'ascending' ? comparison : -comparison;
}
