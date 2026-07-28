/** Blank-capable numeric value used by paper-stat form controls. */
export type OptionalPaperStatistic = number | undefined;

/** Cumulative score stored after one paper point. */
export interface PaperPointScore {
  ourScore: number;
  opponentScore: number;
}

/** The team that scored a paper point, or null while its draft score is invalid. */
export type PaperPointScoringSide = 'us' | 'opponent' | null;

/** Whether the tracked team starts a paper point on offense or defense. */
export type PaperPointStartingPossession = 'offense' | 'defense';

/** Score-derived context displayed for one paper point draft. */
export interface PaperPointClassification {
  startingPossession: PaperPointStartingPossession | null;
  scoringSide: PaperPointScoringSide;
}

/** Display a persisted zero as an empty paper-stat input. */
export function optionalPaperStatistic(value: number): OptionalPaperStatistic {
  return value === 0 ? undefined : value;
}

/** Normalize an empty paper-stat input before persistence. */
export function paperStatisticOrZero(value: OptionalPaperStatistic): number {
  return value ?? 0;
}

/**
 * Classify paper points from cumulative scores.
 *
 * The first point needs an explicit O/D seed because a score alone cannot
 * identify who received the opening pull. After that, the previous scorer
 * determines the next start: a goal by us means we pull on D, while an
 * opponent goal means we receive on O.
 */
export function classifyPaperPoints(
  initialOurScore: number,
  initialOpponentScore: number,
  firstStartingPossession: PaperPointStartingPossession,
  points: readonly PaperPointScore[],
): PaperPointClassification[] {
  let previousOurScore = initialOurScore;
  let previousOpponentScore = initialOpponentScore;
  let startingPossession: PaperPointStartingPossession | null = firstStartingPossession;

  return points.map((point) => {
    const ourIncrease = point.ourScore - previousOurScore;
    const opponentIncrease = point.opponentScore - previousOpponentScore;
    const scoringSide: PaperPointScoringSide =
      ourIncrease === 1 && opponentIncrease === 0
        ? 'us'
        : ourIncrease === 0 && opponentIncrease === 1
          ? 'opponent'
          : null;
    const classification = { startingPossession, scoringSide };

    previousOurScore = point.ourScore;
    previousOpponentScore = point.opponentScore;
    startingPossession =
      scoringSide === 'us' ? 'defense' : scoringSide === 'opponent' ? 'offense' : null;
    return classification;
  });
}

/** Derive each scoring side from persisted cumulative paper-point scores. */
export function paperPointScoringSides(
  initialOurScore: number,
  initialOpponentScore: number,
  points: readonly PaperPointScore[],
): boolean[] {
  return classifyPaperPoints(
    initialOurScore,
    initialOpponentScore,
    'offense',
    points,
  ).map((point, index) => {
    if (point.scoringSide === null) {
      throw new Error(
        `Paper point ${index + 1} score must add exactly one goal to the previous score.`,
      );
    }
    return point.scoringSide === 'us';
  });
}
