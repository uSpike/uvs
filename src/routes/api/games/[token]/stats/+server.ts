import { json } from '@sveltejs/kit';
import { parseGameEventPayload, parseGameEventType } from '$lib/game-events';
import type { StartingPossession, TeamEndzone } from '$lib/game-stats';
import type { SpatialAnnotationRole } from '$lib/game-stats';
import { parseOptionalMatchupRole, type MatchupRole } from '$lib/matchup';
import { requireEditorLock } from '$lib/server/editor-lock';
import { requireGameAccess } from '$lib/server/access';
import {
  GameTrackingRepository,
  type SaveEventInput,
  type SaveHighlightInput,
  type SaveManualSummaryInput,
  type StartPointInput,
} from '$lib/server/game-tracking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
  requireGameAccess(locals, params.token);
  const snapshot = new GameTrackingRepository().getSnapshot(params.token);
  if (!snapshot) return json({ error: 'Game not found.' }, { status: 404 });
  return json(snapshot);
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
  requireGameAccess(locals, params.token);
  try {
    requireEditorLock(params.token, request.headers.get('x-reco-edit-token'));
    const body = await request.json() as Record<string, unknown>;
    const operation = String(body.operation ?? '');
    const repository = new GameTrackingRepository();
    switch (operation) {
      case 'startPoint':
        return json(repository.startPoint(params.token, pointInput(body)));
      case 'updatePoint':
        return json(
          repository.updatePoint(
            params.token,
            positiveInteger(body.pointId, 'Point'),
            pointInput(body),
          ),
        );
      case 'deletePoint':
        return json(repository.deletePoint(params.token, positiveInteger(body.pointId, 'Point')));
      case 'setInitialEndzone':
        return json(repository.setInitialLineupEndzone(params.token, endzone(body.endzone)));
      case 'addEvent':
        return json(repository.addEvent(params.token, eventInput(body)));
      case 'updateEvent':
        return json(
          repository.updateEvent(
            params.token,
            positiveInteger(body.eventId, 'Event'),
            eventInput(body),
          ),
        );
      case 'deleteEvent':
        return json(repository.deleteEvent(params.token, positiveInteger(body.eventId, 'Event')));
      case 'addHighlight':
        return json(repository.addHighlight(params.token, highlightInput(body)));
      case 'updateHighlight':
        return json(
          repository.updateHighlight(
            params.token,
            positiveInteger(body.highlightId, 'Highlight'),
            highlightInput(body),
          ),
        );
      case 'deleteHighlight':
        return json(
          repository.deleteHighlight(
            params.token,
            positiveInteger(body.highlightId, 'Highlight'),
          ),
        );
      case 'setGameMatchupRole':
        return json(
          repository.setGameMatchupRole(
            params.token,
            positiveInteger(body.playerId, 'Player'),
            parseOptionalMatchupRole(body.matchupRole),
          ),
        );
      case 'saveManualSummary':
        return json(repository.saveManualSummary(params.token, manualSummaryInput(body)));
      default:
        return json({ error: 'Select a supported statistics operation.' }, { status: 400 });
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Statistics could not be updated.';
    const status = message.includes('lock') ? 409 : message.endsWith('not found.') ? 404 : 400;
    return json({ error: message }, { status });
  }
};

function pointInput(body: Record<string, unknown>): StartPointInput {
  const possession = String(body.startingPossession ?? '');
  if (possession !== 'offense' && possession !== 'defense') {
    throw new Error('Select whether the point starts on offense or defense.');
  }
  return {
    lineId: positiveInteger(body.lineId, 'Line'),
    startingPossession: possession as StartingPossession,
    startTimeMs: nonNegativeInteger(body.timeMs, 'Pull time'),
    pullerPlayerId: optionalPositiveInteger(body.pullerPlayerId, 'Puller'),
    playerIds: integerArray(body.playerIds, 'Point player'),
    matchupRoleOverrides: matchupRoleOverrides(body.matchupRoleOverrides),
    lineupEndzoneOverride: optionalEndzone(body.lineupEndzoneOverride),
    initialOffenseStrategyId: optionalPositiveInteger(body.initialOffenseStrategyId, 'Offense'),
    initialDefenseStrategyId: optionalPositiveInteger(body.initialDefenseStrategyId, 'Defense'),
  };
}

function endzone(value: unknown): TeamEndzone {
  if (value !== 'left' && value !== 'right') throw new Error('Select the left or right endzone.');
  return value;
}

function optionalEndzone(value: unknown): TeamEndzone | null {
  return value === null || value === undefined || value === '' ? null : endzone(value);
}

function manualSummaryInput(body: Record<string, unknown>): SaveManualSummaryInput {
  if (!Array.isArray(body.playerStatistics) || !Array.isArray(body.points)) {
    throw new Error('Paper statistics must include player totals and point summaries.');
  }
  return {
    playerStatistics: body.playerStatistics.map((value, index) => {
      const row = record(value, `Paper player row ${index + 1}`);
      return {
        playerId: positiveInteger(row.playerId, `Paper player row ${index + 1}`),
        pointsPlayed: nonNegativeInteger(row.pointsPlayed, 'Points played'),
        hockeyAssists: nonNegativeInteger(row.hockeyAssists, 'Hockey assists'),
        assists: nonNegativeInteger(row.assists, 'Assists'),
        goals: nonNegativeInteger(row.goals, 'Goals'),
        blocks: nonNegativeInteger(row.blocks, 'Defenses'),
      };
    }),
    points: body.points.map((value, index) => {
      const row = record(value, `Paper point ${index + 1}`);
      const startingPossession = String(row.startingPossession ?? '');
      if (startingPossession !== 'offense' && startingPossession !== 'defense') {
        throw new Error(`Paper point ${index + 1} must start on offense or defense.`);
      }
      return {
        lineId: positiveInteger(row.lineId, `Paper point ${index + 1} line`),
        startingPossession,
        initialDefenseType: optionalString(row.initialDefenseType),
        offenseStrategyId: optionalPositiveInteger(row.offenseStrategyId, 'Offense'),
        defenseStrategyId: optionalPositiveInteger(row.defenseStrategyId, 'Defense'),
        ourTurnovers: nonNegativeInteger(row.ourTurnovers, `Paper point ${index + 1} turnovers`),
        scoringMethod: optionalString(row.scoringMethod),
        scorerPlayerId: optionalPositiveInteger(row.scorerPlayerId, `Paper point ${index + 1} scorer`),
        ourScore: nonNegativeInteger(row.ourScore, `Paper point ${index + 1} team score`),
        opponentScore: nonNegativeInteger(
          row.opponentScore,
          `Paper point ${index + 1} opponent score`,
        ),
      };
    }),
  };
}

function highlightInput(body: Record<string, unknown>): SaveHighlightInput {
  return {
    startTimeMs: nonNegativeInteger(body.startTimeMs, 'Highlight start'),
    endTimeMs: nonNegativeInteger(body.endTimeMs, 'Highlight end'),
    description: String(body.description ?? ''),
    playerIds: integerArray(body.playerIds, 'Highlight player'),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function matchupRoleOverrides(value: unknown): Record<number, MatchupRole> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Point matchup role overrides must be an object.');
  }
  const parsed: Record<number, MatchupRole> = {};
  for (const [playerIdValue, roleValue] of Object.entries(value)) {
    const playerId = positiveInteger(playerIdValue, 'Point matchup player');
    const role = parseOptionalMatchupRole(roleValue);
    if (role !== null) parsed[playerId] = role;
  }
  return parsed;
}

function eventInput(body: Record<string, unknown>): SaveEventInput {
  const type = parseGameEventType(body.type);
  return {
    pointId: optionalPositiveInteger(body.pointId, 'Point'),
    timeMs: nonNegativeInteger(body.timeMs, 'Event time'),
    type,
    payload: parseGameEventPayload(type, body.payload),
    ...(body.annotations === undefined ? {} : { annotations: spatialAnnotations(body.annotations) }),
  };
}

function spatialAnnotations(value: unknown): NonNullable<SaveEventInput['annotations']> {
  if (!Array.isArray(value)) throw new Error('Spatial annotations must be a list.');
  return value.map((item, index) => {
    const annotation = record(item, `Spatial annotation ${index + 1}`);
    return {
      role: String(annotation.role ?? '') as SpatialAnnotationRole,
      playerId: optionalPositiveInteger(annotation.playerId, 'Annotation player'),
      timeMs: nonNegativeInteger(annotation.timeMs, 'Annotation time'),
      frameIndex: nonNegativeInteger(annotation.frameIndex, 'Annotation frame'),
      panoramaYaw: finiteNumber(annotation.panoramaYaw, 'Annotation yaw'),
      panoramaPitch: finiteNumber(annotation.panoramaPitch, 'Annotation pitch'),
    };
  });
}

function integerArray(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${name} selection must be a list.`);
  return value.map((item) => positiveInteger(item, name));
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} is invalid.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, name: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, name);
}

function nonNegativeInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} is invalid.`);
  return parsed;
}

function finiteNumber(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is invalid.`);
  return parsed;
}
