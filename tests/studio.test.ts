import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CaseContent,
  StudioDraft,
  StudioProject,
} from "../src/shared/types";
import {
  addCue,
  addClue,
  addLink,
  addOutgoing,
  confirmAllStale,
  createEmptyDraft,
  createProject,
  replaceMedia,
  updateClue,
  updateCue,
  updateLink,
  updateOutgoing,
} from "../src/features/studio/model/draft";
import {
  findUnreachable,
  validateDraft,
  type ValidationContext,
} from "../src/features/studio/model/validation";
import {
  buildPublished,
  mergeContent,
  reachableContent,
} from "../src/features/studio/model/publish";
import { remapSnapshot, buildEpisodeMap } from "../src/features/studio/lib/bundle";

const base: CaseContent = {
  id: "fog-harbor-1998",
  title: "雾港来电",
  clues: [{ id: "bell", title: "钟声", kind: "环境声音", description: "" }],
  scenes: [
    {
      id: "arrival",
      title: "来电",
      location: "电台",
      chapter: "01",
      description: "",
      choices: [{ id: "c1", label: "码头", target: "harbor", requires: [], description: "" }],
    },
    {
      id: "harbor",
      title: "码头",
      location: "码头",
      chapter: "02",
      description: "",
      choices: [],
    },
  ],
  episodes: [
    {
      id: "arrival-normal",
      sceneId: "arrival",
      title: "来电",
      version: "",
      description: "",
      audio: "/audio/a.wav",
      duration: 20,
      wave: [],
      cues: [],
    },
  ],
};

function media(assetId: string, duration: number): StudioDraft["media"] {
  return { assetId, name: "x.wav", duration, wave: Array(100).fill(0.3) };
}

function fullDraft(): StudioDraft {
  let d = createEmptyDraft();
  d = { ...d, title: "新现场", location: "仓库", description: "调查延伸" };
  d = { ...d, media: media("asset-1", 30) };
  d = addClue(d);
  const clueId = d.clues[0].id;
  d = updateClue(d, clueId, { title: "脚步声", description: "走廊脚步" });
  d = addCue(d, 0);
  d = updateCue(d, d.cues[0].id, {
    speaker: "林岚",
    text: "这里有人来过。",
    sound: { clueId, start: 0.2, end: 1.2, description: "脚步回声" },
  });
  d = addLink(d, "arrival");
  d = updateLink(d, d.links[0].id, {
    label: "追查仓库动静",
    description: "新入口",
  });
  d = addOutgoing(d, "harbor");
  d = updateOutgoing(d, d.outgoing[0].id, { label: "返回码头" });
  return d;
}

test("完整草稿通过发布校验，缺入口/越界/线索缺失会被拦截", () => {
  const project = createProject();
  const ctx: ValidationContext = { base, projects: [] };
  const draft = fullDraft();
  const ok = validateDraft(draft, ctx, project.id);
  assert.equal(ok.some((i) => i.level === "error"), false);

  const noLink: StudioDraft = { ...draft, links: [] };
  assert.ok(
    validateDraft(noLink, ctx, project.id).some(
      (i) => i.code === "link-missing",
    ),
  );

  const overflow = updateCue(draft, draft.cues[0].id, { end: 99 });
  assert.ok(
    validateDraft(overflow, ctx, project.id).some(
      (i) => i.code === "cue-out-of-bounds",
    ),
  );

  const danglingSound = updateCue(draft, draft.cues[0].id, {
    sound: {
      clueId: "missing-clue",
      start: 0.2,
      end: 1,
      description: "x",
    },
  });
  assert.ok(
    validateDraft(danglingSound, ctx, project.id).some(
      (i) => i.code === "sound-clue-missing",
    ),
  );
});

test("没有可达入口的场景在图遍历中被识别", () => {
  const project = createProject();
  const draft = fullDraft();
  // 入口挂到 harbor，但 harbor 本身从 arrival 可达，所以应可达
  const reachableCtx: ValidationContext = { base, projects: [] };
  const sceneId = `custom-${project.id.slice(0, 8)}`;
  assert.deepEqual(
    findUnreachable(reachableCtx, [{ projectId: project.id, sceneId, draft }]),
    [],
  );

  // 制造孤岛：base 里没有任何场景能到 "harbor" 之外，改为指向不存在的场景
  const isolated = updateLink(draft, draft.links[0].id, {
    fromSceneId: "ghost-scene",
  });
  assert.ok(
    findUnreachable(reachableCtx, [
      { projectId: project.id, sceneId, draft: isolated },
    ]).includes(sceneId),
  );
});

test("替换草稿音频保留文字，失效时间点等待确认后才解除", () => {
  const draft = fullDraft();
  const replaced = replaceMedia(draft, media("asset-2", 0.5));
  assert.equal(replaced.cues[0].text, draft.cues[0].text);
  assert.equal(replaced.cues[0].speaker, draft.cues[0].speaker);
  assert.equal(replaced.cues[0].stale, true);
  assert.equal(replaced.clues.length, draft.clues.length);

  const ctx: ValidationContext = { base, projects: [] };
  assert.ok(
    validateDraft(replaced, ctx, "p1").some((i) => i.code === "cue-stale"),
  );

  const confirmed = confirmAllStale(replaced);
  assert.equal(confirmed.cues[0].stale, false);
  assert.ok(confirmed.cues[0].end <= 0.5 + 0.001);
  assert.equal(
    validateDraft(confirmed, ctx, "p1").some((i) => i.code === "cue-stale"),
    false,
  );
});

test("发布快照合并进内容并注入入口，取消发布后保留版本仍在运行时内容中", () => {
  const project = createProject();
  const draft = fullDraft();
  const published = buildPublished(draft, null, 1000);
  const withProject: StudioProject = {
    ...project,
    status: "published",
    draft,
    published,
  };
  const live = mergeContent(base, [withProject], {
    retainUnpublished: false,
  });
  assert.ok(live.scenes.some((s) => s.id === published.scene.id));
  const arrival = live.scenes.find((s) => s.id === "arrival")!;
  assert.ok(
    arrival.choices.some((c) => c.target === published.scene.id),
    "入口应注入来源场景",
  );
  assert.ok(live.episodes.some((e) => e.id === published.episode.id));
  assert.ok(live.clues.some((c) => c.id === draft.clues[0].id));

  // 取消发布：图内容移除入口与场景
  const unpublished: StudioProject = { ...withProject, status: "draft" };
  const graph = reachableContent(
    mergeContent(base, [unpublished], { retainUnpublished: false }),
  );
  assert.equal(graph.scenes.some((s) => s.id === published.scene.id), false);

  // 运行时内容仍保留，当前调查与旧存档可以继续收听
  const runtime = mergeContent(base, [unpublished], {
    retainUnpublished: true,
  });
  assert.ok(runtime.scenes.some((s) => s.id === published.scene.id));
  assert.ok(runtime.episodes.some((e) => e.id === published.episode.id));
});

test("重新发布保持场景 id 稳定并累加修订号", () => {
  const first = buildPublished(fullDraft(), null, 1);
  const draft2 = { ...fullDraft(), title: "新现场（修订）" };
  const second = buildPublished(draft2, first, 2);
  assert.equal(second.scene.id, first.scene.id);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(second.scene.title, "新现场（修订）");
});

test("导入时存档里的场景/线索/音源 id 按映射重写，内建 id 保持不变", () => {
  const draft = fullDraft();
  const published = buildPublished(draft, null, 1);
  const sourceProjects: StudioProject[] = [
    {
      ...createProject(),
      status: "published",
      draft,
      published,
    },
  ];
  const sceneMap = new Map([[published.scene.id, "custom-imported1"]]);
  // 模拟 importBundle 的线索重写：旧线索 id → 新线索 id
  const newClueId = "custom-clue-imported9";
  const clueMap = new Map([[draft.clues[0].id, newClueId]]);
  const episodeMap = buildEpisodeMap(sourceProjects, sceneMap);
  const snapshot = {
    version: 1 as const,
    caseId: base.id,
    story: {
      sceneId: published.scene.id,
      visited: ["arrival", published.scene.id],
      decisions: [{ sceneId: "arrival", choiceId: "studio-link-x" }],
      ending: null,
    },
    evidence: {
      notes: [
        {
          id: "n1",
          clueId: draft.clues[0].id,
          title: "t",
          text: "x",
          anchor: {
            sceneId: published.scene.id,
            start: 1,
            end: 2,
          },
          createdAt: 1,
          pinned: false,
        },
      ],
      clues: [draft.clues[0].id],
      selectedId: null,
    },
    heard: { [`${published.scene.id}-normal`]: 5 },
    resume: { sceneId: published.scene.id, position: 5, rate: 1 },
  };
  const remapped = remapSnapshot(snapshot, sceneMap, clueMap, episodeMap);
  assert.equal(remapped.story.sceneId, "custom-imported1");
  assert.deepEqual(remapped.story.visited, ["arrival", "custom-imported1"]);
  assert.equal(remapped.evidence.clues[0], newClueId);
  assert.equal(
    remapped.evidence.notes[0].anchor.sceneId,
    "custom-imported1",
  );
  assert.equal(remapped.heard["custom-imported1-normal"], 5);
  // 内建场景不受影响
  assert.equal(remapped.story.decisions[0].sceneId, "arrival");
});
