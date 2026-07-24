import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const STORAGE_KEY_PATTERN = /^[a-f0-9]{24}\/[a-z0-9-]+-[a-f0-9]{8}\/resume-v[1-9][0-9]*\.pdf$/;

export async function writeResumeObject(storageKey: string, bytes: Uint8Array): Promise<void> {
  const target = resolveStoragePath(storageKey);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
}

export async function readResumeObject(storageKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storageKey));
}

export function resolveStoragePath(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("RapidApply rejected an invalid resume storage key.");
  }

  const root = resumeStorageRoot();
  const target = resolve(root, storageKey);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("RapidApply rejected a resume path outside managed storage.");
  }
  return target;
}

function resumeStorageRoot(): string {
  return resolve(process.env.RAPIDAPPLY_RESUME_STORAGE_DIR ?? "./data/resumes");
}
