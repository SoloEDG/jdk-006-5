import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import type { StudioProject } from "../src/shared/types";
import {
  allProjects,
  allMedia,
  deleteProject,
  getMedia,
  putMedia,
  putProject,
} from "../src/features/studio/lib/mediaDb";
import { createProject } from "../src/features/studio/model/draft";

function blob(text: string): Blob {
  return new Blob([text], { type: "audio/wav" });
}

beforeEach(async () => {
  // fake-indexeddb/auto 提供全局 indexedDB；每个用例换一个库名隔离
  // 这里直接清空两个对象库即可
  for (const record of await allMedia()) {
    const { deleteMedia } = await import(
      "../src/features/studio/lib/mediaDb"
    );
    await deleteMedia(record.meta.id);
  }
  for (const project of await allProjects()) await deleteProject(project.id);
});

test("录音与项目写入后可重新读出（模拟刷新页面）", async () => {
  const project: StudioProject = createProject();
  project.draft.title = "仓库回声";
  await putProject(project);
  await putMedia({
    meta: {
      id: "audio-1",
      name: "a.wav",
      mime: "audio/wav",
      size: 10,
      duration: 12,
      wave: [0.2, 0.4],
      createdAt: 1,
    },
    blob: blob("pcm-bytes"),
  });

  const projectsAfter = await allProjects();
  assert.equal(projectsAfter.length, 1);
  assert.equal(projectsAfter[0].draft.title, "仓库回声");
  const mediaAfter = await getMedia("audio-1");
  assert.ok(mediaAfter);
  assert.equal(mediaAfter!.meta.duration, 12);
  assert.equal(await mediaAfter!.blob.text(), "pcm-bytes");
});

test("写入抛错（模拟超额）时上一份录音与项目仍然可用", async () => {
  await putMedia({
    meta: {
      id: "keep",
      name: "good.wav",
      mime: "audio/wav",
      size: 5,
      duration: 8,
      wave: [0.3],
      createdAt: 1,
    },
    blob: blob("good"),
  });
  const project = createProject();
  await putProject(project);

  // 模拟配额超额：让 media 库对新记录的 put 直接抛错
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
    if (
      this.name === "media" &&
      args[0] &&
      (args[0] as { meta?: { id: string } }).meta?.id === "too-big"
    ) {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    }
    return realPut.apply(this, args as never) as IDBRequest;
  };

  await assert.rejects(
    putMedia({
      meta: {
        id: "too-big",
        name: "big.wav",
        mime: "audio/wav",
        size: 999,
        duration: 99,
        wave: [],
        createdAt: 2,
      },
      blob: blob("x".repeat(100)),
    }),
    /QuotaExceededError/,
  );

  IDBObjectStore.prototype.put = realPut;

  // 上一份录音仍在
  const kept = await getMedia("keep");
  assert.ok(kept);
  assert.equal(await kept!.blob.text(), "good");
  // 项目记录未受影响
  const projects = await allProjects();
  assert.equal(projects.length, 1);
  // 失败的录音没有落库
  assert.equal((await allMedia()).length, 1);
  assert.equal(await getMedia("too-big"), undefined);
});
