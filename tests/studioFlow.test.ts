import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaseContent, StudioDraft } from "../src/shared/types";
import { CASE_CONTENT } from "../src/features/story";
import {
  addCue,
  addClue,
  addLink,
  addOutgoing,
  createProject,
  replaceMedia,
  updateClue,
  updateCue,
  updateLink,
  updateOutgoing,
  confirmAllStale,
} from "../src/features/studio/model/draft";
import {
  validateDraft,
  findUnreachable,
  type ValidationContext,
} from "../src/features/studio/model/validation";
import {
  buildPublished,
  mergeContent,
  reachableContent,
} from "../src/features/studio/model/publish";

const base: CaseContent = CASE_CONTENT;

function media(id: string, duration: number): StudioDraft["media"] {
  return {
    assetId: id,
    name: "scene.wav",
    duration,
    wave: Array.from({ length: 100 }, (_, i) => 0.2 + (i % 5) * 0.1),
  };
}

test("端到端：从空草稿到发布接入，再替换音频并重新发布的完整业务流", () => {
  const project = createProject();
  const ctx = (projects = [project]): ValidationContext => ({
    base,
    projects,
  });

  // 1. 空草稿应被拦截：缺录音、缺元信息、缺入口
  let issues = validateDraft(project.draft, ctx(), project.id);
  assert.ok(issues.some((i) => i.code === "media-missing"));
  assert.ok(issues.some((i) => i.code === "meta-missing"));
  assert.ok(issues.some((i) => i.code === "link-missing"));

  // 2. 上传录音 + 元信息
  let d: StudioDraft = {
    ...project.draft,
    title: "码头仓库的回声",
    location: "三号仓库",
    description: "雾笛之后的第二处现场",
    media: media("asset-a", 20),
  };

  // 3. 定义线索
  d = addClue(d);
  const clueId = d.clues[0].id;
  d = updateClue(d, clueId, { title: "金属碰撞", description: "仓库里的回声" });

  // 4. 逐句字幕
  d = addCue(d, 0);
  d = updateCue(d, d.cues[0].id, {
    speaker: "林岚",
    text: "雾笛停了，可仓库里还有回声。",
  });
  d = addCue(d, 8);
  d = updateCue(d, d.cues[1].id, {
    speaker: "阿渡",
    text: "这声音，像是有人在拖铁链。",
    sound: { clueId, start: 8.5, end: 10, description: "铁链拖地声" },
  });

  // 5. 接入口（从码头场景）与后续方向（回电台）
  d = addLink(d, "harbor");
  d = updateLink(d, d.links[0].id, {
    label: "追查仓库回声",
    description: "雾笛之外的异常",
  });
  d = addOutgoing(d, "arrival");
  d = updateOutgoing(d, d.outgoing[0].id, { label: "带着录音回电台" });

  // 6. 校验通过且可达（场景 id 以首次发布结果为准）
  const provisionalSceneId = `custom-${project.id.slice(0, 8)}`;
  issues = validateDraft(
    d,
    ctx([{ ...project, draft: d }]),
    project.id,
    provisionalSceneId,
  );
  assert.deepEqual(
    issues.filter((i) => i.level === "error"),
    [],
    "完整草稿不应有阻断错误",
  );

  // 7. 发布并合并进故事
  const published = buildPublished(d, null, Date.now());
  const sceneId = published.scene.id;
  const unreachable = findUnreachable(
    ctx([{ ...project, draft: d }]),
    [{ projectId: project.id, sceneId, draft: d }],
  );
  assert.deepEqual(unreachable, []);
  const liveProject = {
    ...project,
    status: "published" as const,
    draft: d,
    published,
  };
  const live = mergeContent(base, [liveProject], { retainUnpublished: false });
  const harbor = live.scenes.find((s) => s.id === "harbor")!;
  assert.ok(harbor.choices.some((c) => c.target === sceneId), "入口应注入码头场景");
  assert.ok(live.episodes.some((e) => e.id === published.episode.id));
  assert.ok(live.clues.some((c) => c.id === clueId));
  // 图内容包含新场景且可达
  const graph = reachableContent(live);
  assert.ok(graph.scenes.some((s) => s.id === sceneId));

  // 8. 替换草稿音频（更短）：文字保留、时间点失效
  const replaced = replaceMedia(d, media("asset-b", 5));
  assert.equal(replaced.cues.length, 2);
  assert.equal(replaced.cues[0].text, d.cues[0].text);
  assert.ok(replaced.cues.some((c) => c.stale), "超出新时长的句子应失效");
  assert.ok(
    validateDraft(replaced, ctx([liveProject]), project.id, sceneId).some(
      (i) => i.code === "cue-stale",
    ),
    "失效时间点应阻断发布",
  );

  // 9. 一键确认后重新校验通过并重新发布（场景 id 稳定）
  const confirmed = confirmAllStale(replaced);
  assert.ok(confirmed.cues.every((c) => !c.stale));
  assert.deepEqual(
    validateDraft(confirmed, ctx([liveProject]), project.id, sceneId).filter(
      (i) => i.level === "error",
    ),
    [],
  );
  const republished = buildPublished(confirmed, published, Date.now());
  assert.equal(republished.scene.id, published.scene.id, "重新发布场景 id 必须稳定");
  assert.equal(republished.revision, published.revision + 1);
  assert.equal(republished.mediaAssetId, "asset-b");

  // 10. 取消发布：图中移除入口，但运行时保留版本可继续收听
  const unpublished = {
    ...liveProject,
    status: "draft" as const,
    draft: confirmed,
    published: republished,
  };
  const graphAfter = reachableContent(
    mergeContent(base, [unpublished], { retainUnpublished: false }),
  );
  assert.equal(graphAfter.scenes.some((s) => s.id === sceneId), false);
  const runtimeAfter = mergeContent(base, [unpublished], {
    retainUnpublished: true,
  });
  assert.ok(runtimeAfter.episodes.some((e) => e.id === published.episode.id));
  assert.ok(runtimeAfter.scenes.some((s) => s.id === sceneId));
});

test("没有可达入口时发布被可达性检查拦截", () => {
  const project = createProject();
  let d: StudioDraft = {
    ...project.draft,
    title: "孤岛",
    location: "未知",
    media: media("a", 10),
  };
  d = addLink(d, "arrival");
  d = updateLink(d, d.links[0].id, { label: "入口" });
  d = addCue(d, 0);
  d = updateCue(d, d.cues[0].id, { speaker: "旁白", text: "测试" });
  const sceneId = `custom-${project.id.slice(0, 8)}`;
  // 把入口改到一个从 arrival 不可达的虚拟场景
  const broken = updateLink(d, d.links[0].id, { fromSceneId: "no-such-place" });
  const ctx: ValidationContext = { base, projects: [] };
  assert.ok(
    findUnreachable(ctx, [{ projectId: project.id, sceneId, draft: broken }]).includes(
      sceneId,
    ),
  );
});
