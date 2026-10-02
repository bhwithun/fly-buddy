export const MEET_BUFFERS = [10, 20, 30, 45] as const;
export type MeetBuffer = (typeof MEET_BUFFERS)[number];

export function normalizeBuffer(value: number): MeetBuffer {
  return MEET_BUFFERS.includes(value as MeetBuffer) ? (value as MeetBuffer) : 20;
}

export type LeavePlan = {
  arrivalUnix: number;
  readyUnix: number;
  leaveUnix: number;
  driveSeconds: number;
  bufferMinutes: number;
  leaveNow: boolean;
  /** How late the curb arrival is if you leave immediately. Zero when there is still time. */
  lateBySeconds: number;
};

export function planLeave(input: {
  arrivalUnix: number;
  driveSeconds: number;
  bufferMinutes: number;
  nowUnix?: number;
}): LeavePlan {
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  const driveSeconds = Math.max(0, Math.round(input.driveSeconds));
  const bufferMinutes = normalizeBuffer(input.bufferMinutes);
  const readyUnix = input.arrivalUnix + bufferMinutes * 60;
  const leaveUnix = readyUnix - driveSeconds;
  const leaveNow = leaveUnix <= nowUnix;
  const lateBySeconds = leaveNow ? Math.max(0, nowUnix + driveSeconds - readyUnix) : 0;
  return {
    arrivalUnix: input.arrivalUnix,
    readyUnix,
    leaveUnix,
    driveSeconds,
    bufferMinutes,
    leaveNow,
    lateBySeconds,
  };
}

export function arrivalInstant(times: {
  actual: number | null;
  estimated: number | null;
  scheduled: number | null;
}): number | null {
  return times.actual ?? times.estimated ?? times.scheduled;
}
