/// <reference lib="webworker" />
import { bboxToHexCells } from '../compute/grid';
import { groupDestinations, scoreHex } from '../compute/score';
import type { Chain, Destination, HexScore } from '../state/types';

export interface ComputeRequest {
  type: 'compute';
  bbox: [number, number, number, number];
  resolution: number;
  destinations: Destination[];
  chains: Chain[];
}

export interface ComputeResult {
  type: 'result';
  hexScores: HexScore[];
  resolution: number;
  cellCount: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ComputeRequest>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;
  const cells = bboxToHexCells(msg.bbox, msg.resolution);
  const groups = groupDestinations(msg.destinations, msg.chains);
  const hexScores: HexScore[] = cells.map((c) => scoreHex(c, groups));
  const out: ComputeResult = {
    type: 'result',
    hexScores,
    resolution: msg.resolution,
    cellCount: cells.length,
  };
  ctx.postMessage(out);
};
