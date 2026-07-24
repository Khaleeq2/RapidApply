import type {
  ExecutionRecording,
  ExecutionRecordingEntry,
  RecordingSummary,
} from "../recording/types";

const RECORDING_PREFIX = "rapidapply.recording.";
const MAX_ENTRIES_PER_RUN = 80;

export async function lockLocalStorageToTrustedContexts(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

export async function appendRecordingEntry(
  entry: Omit<ExecutionRecordingEntry, "id" | "sequence">,
): Promise<{ recording: ExecutionRecording; appended: boolean }> {
  const existing = await getExecutionRecording(entry.runId);
  if (existing?.entries.some((candidate) =>
    (candidate.checkpointName
      ? candidate.checkpointName === entry.checkpointName
      : candidate.observation.fingerprint === entry.observation.fingerprint) &&
    candidate.tabId === entry.tabId
  )) {
    return { recording: existing, appended: false };
  }

  const now = entry.capturedAt;
  const recording: ExecutionRecording = existing ?? {
    schemaVersion: 1,
    runId: entry.runId,
    executorSessionId: entry.executorSessionId,
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
  const nextEntry: ExecutionRecordingEntry = {
    ...entry,
    id: crypto.randomUUID(),
    sequence: (recording.entries.at(-1)?.sequence ?? 0) + 1,
  };
  const entries = [...recording.entries, nextEntry].slice(-MAX_ENTRIES_PER_RUN);
  const updated = { ...recording, updatedAt: now, entries };
  await chrome.storage.local.set({ [recordingKey(entry.runId)]: updated });
  return { recording: updated, appended: true };
}

export async function getExecutionRecording(runId: string): Promise<ExecutionRecording | null> {
  const key = recordingKey(runId);
  const result = await chrome.storage.local.get(key);
  const stored = (result[key] as ExecutionRecording | undefined) ?? null;
  if (!stored) return null;
  const cleaned = stripScreenshotData(stored);
  if (JSON.stringify(cleaned) !== JSON.stringify(stored)) {
    await chrome.storage.local.set({ [key]: cleaned });
  }
  return cleaned;
}

export async function listRecordingSummaries(): Promise<RecordingSummary[]> {
  const all = await chrome.storage.local.get(null);
  const recordings = await Promise.all(Object.keys(all)
    .filter((key) => key.startsWith(RECORDING_PREFIX))
    .map((key) => getExecutionRecording(key.slice(RECORDING_PREFIX.length))));
  return recordings
    .filter((recording): recording is ExecutionRecording => recording !== null)
    .map(toSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function clearExecutionRecording(runId: string): Promise<void> {
  await chrome.storage.local.remove(recordingKey(runId));
}

function recordingKey(runId: string): string {
  return `${RECORDING_PREFIX}${runId}`;
}

function toSummary(recording: ExecutionRecording): RecordingSummary {
  return {
    runId: recording.runId,
    executorSessionId: recording.executorSessionId,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    entryCount: recording.entries.length,
  };
}

function stripScreenshotData(recording: ExecutionRecording): ExecutionRecording {
  const entries = recording.entries.map((entry) => {
    const legacy = entry as ExecutionRecordingEntry & {
      screenshot?: unknown;
      screenshotStatus?: unknown;
    };
    const cleaned = { ...legacy };
    delete cleaned.screenshot;
    delete cleaned.screenshotStatus;
    return cleaned as ExecutionRecordingEntry;
  });
  return {
    schemaVersion: recording.schemaVersion,
    runId: recording.runId,
    executorSessionId: recording.executorSessionId,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    entries,
  };
}
