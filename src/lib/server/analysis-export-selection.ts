/**
 * Resolve optional event-export game selectors in the event's existing
 * chronological order.
 *
 * Supported query forms are repeated `gameId` parameters and comma-separated
 * `games` parameters. When neither is present, every available game is selected.
 */
export function selectAnalysisExportGameIds(
  searchParams: URLSearchParams,
  availableGameIds: number[],
): number[] {
  const hasSelection = searchParams.has('gameId') || searchParams.has('games');
  if (!hasSelection) return [...availableGameIds];

  const rawIds = [...searchParams.getAll('gameId')];
  for (const group of searchParams.getAll('games')) {
    const values = group.split(',');
    if (values.some((value) => value.trim() === '')) {
      throw new Error('Select at least one valid game to export.');
    }
    rawIds.push(...values);
  }
  if (rawIds.length === 0 || rawIds.some((value) => value.trim() === '')) {
    throw new Error('Select at least one valid game to export.');
  }

  const selectedIds = new Set(
    rawIds.map((value) => {
      const normalized = value.trim();
      if (!/^[1-9]\d*$/u.test(normalized)) {
        throw new Error('Game selections must be positive integer IDs.');
      }
      const parsed = Number(normalized);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error('Game selections must be positive integer IDs.');
      }
      return parsed;
    }),
  );
  if (selectedIds.size === 0) {
    throw new Error('Select at least one valid game to export.');
  }

  const availableIds = new Set(availableGameIds);
  const unavailableIds = [...selectedIds].filter((id) => !availableIds.has(id));
  if (unavailableIds.length > 0) {
    throw new Error(
      `${unavailableIds.length === 1 ? 'Selected game does' : 'Selected games do'} not belong to this event.`,
    );
  }

  return availableGameIds.filter((id) => selectedIds.has(id));
}
