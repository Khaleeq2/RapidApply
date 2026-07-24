import type { AdapterObservation } from "../adapters/types";

export interface ExecutionRecordingEntry {
  id: string;
  sequence: number;
  runId: string;
  executorSessionId: string;
  tabId: number;
  checkpointName: string;
  capturedAt: string;
  observation: AdapterObservation;
}

export interface ExecutionRecording {
  schemaVersion: 1;
  runId: string;
  executorSessionId: string;
  createdAt: string;
  updatedAt: string;
  entries: ExecutionRecordingEntry[];
}

export interface RecordingSummary {
  runId: string;
  executorSessionId: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
}
