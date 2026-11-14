import type {
  CaseContent,
  SceneId,
  StudioDraft,
  StudioProject,
  ValidationIssue,
} from "../../../shared/types";

export interface ValidationContext {
  base: CaseContent;
  projects: StudioProject[];
}

function issue(
  level: ValidationIssue["level"],
  code: ValidationIssue["code"],
  message: string,
): ValidationIssue {
  return { level, code, message };
}

/** 校验单个草稿（假设它将被发布到图中） */
export function validateDraft(
  draft: StudioDraft,
  ctx: ValidationContext,
  selfProjectId?: string,
  selfSceneId?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const duration = draft.media?.duration ?? 0;

  if (!draft.media)
    issues.push(issue("error", "media-missing", "还没有上传录音文件"));
  if (!draft.title.trim())
    issues.push(issue("error", "meta-missing", "请填写场景标题"));
  if (!draft.location.trim())
    issues.push(issue("error", "meta-missing", "请填写场景地点"));

  // 线索定义索引：内建 + 本草稿 + 其他项目已发布线索
  const knownClues = new Set<string>(ctx.base.clues.map((c) => c.id));
  draft.clues.forEach((c) => knownClues.add(c.id));
  ctx.projects.forEach((p) =>
    p.published?.clues.forEach((c) => knownClues.add(c.id)),
  );

  // 已知场景：内建 + 其他项目已发布场景 + 本项目（重新编辑时指向自身的选项）
  const knownScenes = new Set<SceneId>(ctx.base.scenes.map((s) => s.id));
  ctx.projects.forEach((p) => {
    if (p.published) knownScenes.add(p.published.scene.id);
  });
  if (selfSceneId) knownScenes.add(selfSceneId);
  else if (selfProjectId) knownScenes.add(selfProjectId);

  // ---- 字幕句 ----
  if (draft.cues.length === 0)
    issues.push(issue("warning", "cue-empty", "还没有添加任何字幕句"));
  const sorted = [...draft.cues].sort((a, b) => a.start - b.start);
  for (const cue of sorted) {
    if (cue.stale)
      issues.push(
        issue(
          "error",
          "cue-stale",
          `有一句字幕的时间点在新音频中失效，请先确认：「${cue.text || "未填写字幕"}」`,
        ),
      );
    if (!cue.speaker.trim() || !cue.text.trim())
      issues.push(
        issue(
          "error",
          "cue-empty",
          `${fmt(cue.start)} 的字幕缺少说话人或字幕文字`,
        ),
      );
    if (
      draft.media &&
      (cue.start < 0 ||
        cue.end <= cue.start ||
        cue.end > duration + 0.001 ||
        cue.start > duration)
    )
      issues.push(
        issue(
          "error",
          "cue-out-of-bounds",
          `字幕「${cue.text || fmt(cue.start)}」的时间范围超出录音长度（${fmt(duration)}）`,
        ),
      );
    if (cue.end <= cue.start)
      issues.push(
        issue(
          "error",
          "cue-order",
          `字幕「${cue.text || fmt(cue.start)}」的结束时间必须晚于开始时间`,
        ),
      );
    if (cue.sound) {
      if (!cue.sound.description.trim())
        issues.push(
          issue(
            "error",
            "sound-empty",
            `字幕「${cue.text || fmt(cue.start)}」的声音线索缺少描述`,
          ),
        );
      if (!cue.sound.clueId.trim())
        issues.push(
          issue(
            "error",
            "sound-clue-missing",
            `字幕「${cue.text || fmt(cue.start)}」的声音窗口还没有选择线索，请先在「声音线索」页定义`,
          ),
        );
      else if (!knownClues.has(cue.sound.clueId))
        issues.push(
          issue(
            "error",
            "sound-clue-missing",
            `字幕「${cue.text || fmt(cue.start)}」引用的声音线索定义不存在`,
          ),
        );
      if (
        draft.media &&
        (cue.sound.start < cue.start - 0.001 ||
          cue.sound.end > cue.end + 0.001 ||
          cue.sound.end <= cue.sound.start)
      )
        issues.push(
          issue(
            "error",
            "sound-out-of-bounds",
            `字幕「${cue.text || fmt(cue.start)}」的声音窗口超出该句范围`,
          ),
        );
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end - 0.001)
      issues.push(
        issue(
          "warning",
          "cue-overlap",
          `${fmt(sorted[i - 1].start)} 与 ${fmt(sorted[i].start)} 的字幕时间重叠`,
        ),
      );
  }

  // ---- 入口（接到已有调查方向）----
  if (draft.links.length === 0)
    issues.push(
      issue("error", "link-missing", "至少保留一个入口，把场景接到已有调查方向"),
    );
  for (const link of draft.links) {
    if (!knownScenes.has(link.fromSceneId))
      issues.push(
        issue("error", "link-scene-missing", "有一个入口的来源场景已经不存在"),
      );
    if (!link.label.trim())
      issues.push(
        issue("error", "link-missing", "有一个入口还没有填写调查方向名称"),
      );
    for (const clueId of link.requires)
      if (!knownClues.has(clueId))
        issues.push(
          issue("error", "link-clue-missing", `入口「${link.label || "未命名"}」需要的线索不存在`),
        );
  }

  // ---- 后续方向 ----
  const seenTargets = new Set<string>();
  for (const choice of draft.outgoing) {
    if (!choice.label.trim())
      issues.push(issue("error", "choice-duplicate", "有一个后续方向还没有填写名称"));
    if (!knownScenes.has(choice.target))
      issues.push(
        issue("error", "choice-target-missing", `后续方向「${choice.label || "未命名"}」指向的场景不存在`),
      );
    if (seenTargets.has(choice.target))
      issues.push(
        issue("warning", "choice-duplicate", `有两个后续方向指向同一个场景：${choice.target}`),
      );
    seenTargets.add(choice.target);
    for (const clueId of choice.requires)
      if (!knownClues.has(clueId))
        issues.push(
          issue("error", "choice-clue-missing", `后续方向「${choice.label || "未命名"}」需要的线索不存在`),
        );
  }

  return issues;
}

/**
 * 全图可达性：从 arrival 出发，沿内建选项、各项目入口与自定义场景的后续方向遍历，
 * 找出没有可达入口的场景。
 */
export function findUnreachable(
  ctx: ValidationContext,
  drafts: { projectId: string; sceneId: SceneId; draft: StudioDraft }[],
): SceneId[] {
  const adjacency = new Map<SceneId, SceneId[]>();
  const addEdge = (from: SceneId, to: SceneId) => {
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  };
  for (const scene of ctx.base.scenes)
    for (const choice of scene.choices) addEdge(scene.id, choice.target);
  for (const project of ctx.projects) {
    if (!project.published) continue;
    for (const link of project.published.links)
      addEdge(link.fromSceneId, project.published.scene.id);
    for (const choice of project.published.scene.choices)
      addEdge(project.published.scene.id, choice.target);
  }
  for (const item of drafts) {
    for (const link of item.draft.links)
      addEdge(link.fromSceneId, item.sceneId);
    for (const choice of item.draft.outgoing)
      addEdge(item.sceneId, choice.target);
  }
  const reachable = new Set<SceneId>(["arrival"]);
  const queue: SceneId[] = ["arrival"];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? [])
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
  }
  return drafts
    .filter((item) => !reachable.has(item.sceneId))
    .map((item) => item.sceneId);
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
