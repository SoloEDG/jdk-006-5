import type {
  CaseContent,
  Choice,
  ClueDefinition,
  Cue,
  Episode,
  PublishedScene,
  Scene,
  SceneId,
  StudioDraft,
  StudioProject,
} from "../../../shared/types";

export const STUDIO_SCENE_PREFIX = "custom-";
export const MEDIA_PROTOCOL = "media://";

export function isStudioScene(id: SceneId): boolean {
  return id.startsWith(STUDIO_SCENE_PREFIX);
}

export function isStudioAudio(src: string): boolean {
  return src.startsWith(MEDIA_PROTOCOL);
}

export function mediaAssetIdFromSrc(src: string): string | null {
  return isStudioAudio(src) ? src.slice(MEDIA_PROTOCOL.length) : null;
}

function buildCues(draft: StudioDraft): Cue[] {
  return [...draft.cues]
    .sort((a, b) => a.start - b.start)
    .map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
      speaker: cue.speaker.trim(),
      text: cue.text.trim(),
      ...(cue.sound
        ? {
            sound: {
              clueId: cue.sound.clueId,
              start: cue.sound.start,
              end: cue.sound.end,
              description: cue.sound.description.trim(),
            },
          }
        : {}),
    }));
}

/** 草稿 → 不可变发布快照；sceneId 在项目首次发布时生成，之后保持稳定 */
export function buildPublished(
  draft: StudioDraft,
  previous: PublishedScene | null,
  now: number,
): PublishedScene {
  if (!draft.media) throw new Error("草稿还没有录音，无法发布");
  const sceneId =
    previous?.scene.id ??
    `${STUDIO_SCENE_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
  const choices: Choice[] = draft.outgoing.map((choice) => ({
    id: choice.id,
    label: choice.label.trim(),
    target: choice.target,
    requires: [...choice.requires],
    description: choice.description.trim(),
  }));
  const scene: Scene = {
    id: sceneId,
    title: draft.title.trim(),
    location: draft.location.trim(),
    chapter: "", // 自定义场景不占用内建章节编号
    description: draft.description.trim(),
    choices,
  };
  const episode: Episode = {
    id: `${sceneId}-normal`,
    sceneId,
    title: draft.title.trim(),
    version: "自创录音",
    description: draft.description.trim(),
    audio: `${MEDIA_PROTOCOL}${draft.media.assetId}`,
    duration: draft.media.duration,
    cues: buildCues(draft),
    wave: draft.media.wave,
  };
  const clues: ClueDefinition[] = draft.clues.map((clue) => ({
    id: clue.id,
    title: clue.title.trim(),
    kind: clue.kind.trim() || "环境声音",
    description: clue.description.trim(),
  }));
  return {
    scene,
    episode,
    clues,
    links: draft.links.map((link) => ({ ...link, requires: [...link.requires] })),
    mediaAssetId: draft.media.assetId,
    publishedAt: now,
    revision: (previous?.revision ?? 0) + 1,
    clueIds: draft.clues.map((clue) => clue.id),
  };
}

interface MergeOptions {
  // true（运行时）：连已取消发布的保留版本一起合并，保证当前调查与旧存档仍可收听
  retainUnpublished: boolean;
}

/** 把所有发布快照合并进案件内容，返回全新对象（不修改内建内容） */
export function mergeContent(
  base: CaseContent,
  projects: StudioProject[],
  options: MergeOptions,
): CaseContent {
  const scenes: Scene[] = base.scenes.map((s) => ({
    ...s,
    choices: [...s.choices],
  }));
  const episodes: Episode[] = base.episodes.map((e) => ({
    ...e,
    cues: e.cues.map((c) => ({ ...c })),
  }));
  const clues: ClueDefinition[] = [...base.clues];
  const clueIds = new Set(clues.map((c) => c.id));

  for (const project of projects) {
    const published = project.published;
    if (!published) continue;
    if (!options.retainUnpublished && project.status !== "published") continue;

    scenes.push({ ...published.scene, choices: [...published.scene.choices] });
    episodes.push({
      ...published.episode,
      cues: published.episode.cues.map((c) => ({ ...c })),
      wave: [...published.episode.wave],
    });
    for (const clue of published.clues)
      if (!clueIds.has(clue.id)) {
        clues.push({ ...clue });
        clueIds.add(clue.id);
      }
    // 入口：向来源场景注入调查方向
    for (const link of published.links) {
      const target = scenes.find((s) => s.id === link.fromSceneId);
      if (!target) continue;
      const choiceId = `studio-link-${link.id}`;
      target.choices = target.choices.filter((c) => c.id !== choiceId);
      target.choices.push({
        id: choiceId,
        label: link.label.trim() || published.scene.title,
        target: published.scene.id,
        requires: [...link.requires],
        description: link.description.trim() || published.scene.description,
      });
    }
  }
  return { ...base, scenes, episodes, clues };
}

/** 从 arrival 沿选项做可达性遍历，返回仅包含可达场景的内容 */
export function reachableContent(content: CaseContent): CaseContent {
  const reachable = new Set<SceneId>(["arrival"]);
  const queue: SceneId[] = ["arrival"];
  while (queue.length) {
    const current = queue.shift()!;
    const scene = content.scenes.find((s) => s.id === current);
    for (const choice of scene?.choices ?? [])
      if (!reachable.has(choice.target)) {
        reachable.add(choice.target);
        queue.push(choice.target);
      }
  }
  const scenes = content.scenes.filter((s) => reachable.has(s.id));
  const episodes = content.episodes.filter((e) => reachable.has(e.sceneId));
  const usedClues = new Set<string>();
  for (const episode of episodes)
    for (const cue of episode.cues)
      if (cue.sound) usedClues.add(cue.sound.clueId);
  for (const scene of scenes)
    for (const choice of scene.choices)
      choice.requires.forEach((id) => usedClues.add(id));
  const clues = content.clues.filter(
    (clue) =>
      // 内建线索始终保留（与原调查的线索追踪面板兼容）
      !clue.id.startsWith("custom-clue-") || usedClues.has(clue.id),
  );
  return { ...content, scenes, episodes, clues };
}
