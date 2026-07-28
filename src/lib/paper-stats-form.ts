/** Blank-capable numeric value used by paper-stat form controls. */
export type OptionalPaperStatistic = number | undefined;

/** Cumulative score stored after one paper point. */
export interface PaperPointScore {
  ourScore: number;
  opponentScore: number;
}

/** Display a persisted zero as an empty paper-stat input. */
export function optionalPaperStatistic(value: number): OptionalPaperStatistic {
  return value === 0 ? undefined : value;
}

/** Normalize an empty paper-stat input before persistence. */
export function paperStatisticOrZero(value: OptionalPaperStatistic): number {
  return value ?? 0;
}

/** Derive each scoring side from persisted cumulative paper-point scores. */
export function paperPointScoringSides(
  initialOurScore: number,
  initialOpponentScore: number,
  points: readonly PaperPointScore[],
): boolean[] {
  let previousOurScore = initialOurScore;
  let previousOpponentScore = initialOpponentScore;
  return points.map((point, index) => {
    const ourIncrease = point.ourScore - previousOurScore;
    const opponentIncrease = point.opponentScore - previousOpponentScore;
    if (
      !(
        (ourIncrease === 1 && opponentIncrease === 0) ||
        (ourIncrease === 0 && opponentIncrease === 1)
      )
    ) {
      throw new Error(
        `Paper point ${index + 1} score must add exactly one goal to the previous score.`,
      );
    }
    previousOurScore = point.ourScore;
    previousOpponentScore = point.opponentScore;
    return ourIncrease === 1;
  });
}

/** Build persisted cumulative scores from binary paper-point scoring controls. */
export function cumulativePaperPointScores(
  initialOurScore: number,
  initialOpponentScore: number,
  ourGoals: readonly boolean[],
): PaperPointScore[] {
  let ourScore = initialOurScore;
  let opponentScore = initialOpponentScore;
  return ourGoals.map((ourGoal) => {
    if (ourGoal) ourScore += 1;
    else opponentScore += 1;
    return { ourScore, opponentScore };
  });
}
