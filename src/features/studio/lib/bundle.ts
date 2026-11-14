import type {
  CasePack,
  CaseSnapshot,
  SaveSlot,
  StudioBundle,
  StudioMediaPayload,
  StudioProject,
} from "../../../shared/types";
import { newId } from "../../../shared/time";
import { MEDIA_PROTOCOL, STUDIO_SCENE_PREFIX } from "../model/publish";
import { getMedia, putMedia, putProject } from "./mediaDb";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string")
        return reject(new Error("录音编码失败"));
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("录音编码失败"));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(payload: StudioMediaPayload): Blob {
  const binary = atob(payload.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: payload.mime || "audio/mpeg" });
}

function referencedAssets(projects: StudioProject[]): string[] {
  const ids = new Set<string>();
  for (const project of projects) {
    if (project.draft.media) ids.add(project.draft.media.assetId);
    if (project.published) ids.add(project.published.mediaAssetId);
  }
  return [...ids];
}

/** 打包创作区：录音以 base64 内嵌，导出再导入后仍可播放 */
export async function buildBundle(
  projects: StudioProject[],
): Promise<StudioBundle> {
  const media: StudioMediaPayload[] = [];
  for (const assetId of referencedAssets(projects)) {
    const record = await getMedia(assetId);
    if (!record) continue;
    media.push({
      id: assetId,
      name: record.meta.name,
      mime: record.meta.mime,
      dataBase64: await blobToBase64(record.blob),
    });
  }
  return {
    format: "midnight-frequency-studio",
    version: 1,
    exportedAt: Date.now(),
    projects: structuredClone(projects),
    media,
  };
}

export async function buildCasePack(
  slot: SaveSlot,
  projects: StudioProject[],
): Promise<CasePack> {
  return {
    format: "midnight-frequency-case",
    version: 1,
    exportedAt: Date.now(),
    slot: structuredClone(slot),
    studio: await buildBundle(projects),
  };
}

function assertBundle(input: unknown): StudioBundle {
  if (!input || typeof input !== "object")
    throw new Error("导入文件格式无效");
  const b = input as Record<string, unknown>;
  if (b.format !== "midnight-frequency-studio")
    throw new Error("不是雾港创作区导出文件");
  if (b.version !== 1) throw new Error("不支持的创作区版本");
  if (!Array.isArray(b.projects) || !Array.isArray(b.media))
    throw new Error("创作区文件内容损坏");
  return b as unknown as StudioBundle;
}

/**
 * 导入创作区包：项目与录音全部重映射为新 ID，不覆盖当前设备上的版本。
 * 音频先于项目写入：若超额抛错则整体中止，已发布内容保持原样可用。
 * 返回导入项目与「旧场景 id → 新场景 id」映射，供重写存档引用。
 */
export async function importBundle(input: unknown): Promise<{
  projects: StudioProject[];
  sceneMap: Map<string, string>;
  clueMap: Map<string, string>;
}> {
  const bundle = assertBundle(input);

  // 第一遍：写入录音，建立 assetId 映射
  const assetMap = new Map<string, string>();
  for (const payload of bundle.media) {
    if (typeof payload.dataBase64 !== "string" || !payload.dataBase64)
      throw new Error("录音数据缺失，导入中止");
    const nextId = newId();
    await putMedia({
      meta: {
        id: nextId,
        name: payload.name,
        mime: payload.mime,
        size: 0,
        duration: 0,
        wave: [],
        createdAt: Date.now(),
      },
      blob: base64ToBlob(payload),
    });
    assetMap.set(payload.id, nextId);
  }

  // 第二遍：克隆项目、重写发布快照中的 ID，同时建立场景映射
  const sceneMap = new Map<string, string>();
  const globalClueMap = new Map<string, string>();
  const cloned: StudioProject[] = bundle.projects.map((source) => {
    const project: StudioProject = structuredClone(source);
    project.id = newId();
    if (project.draft.media) {
      const mapped = assetMap.get(project.draft.media.assetId);
      if (mapped) project.draft.media.assetId = mapped;
    }
    if (project.published) {
      const oldSceneId = project.published.scene.id;
      const newSceneId = `${STUDIO_SCENE_PREFIX}${project.id.slice(0, 8)}`;
      sceneMap.set(oldSceneId, newSceneId);
      const mappedAsset = assetMap.get(project.published.mediaAssetId);

      // 线索 id 重映射，避免与本机已有创作的线索 id 冲突
      const localClueMap = new Map<string, string>();
      const nextClues = project.published.clues.map((clue, i) => {
        const oldId = project.published!.clueIds[i] ?? clue.id;
        const nextId = `custom-clue-${newId().slice(0, 8)}`;
        localClueMap.set(oldId, nextId);
        globalClueMap.set(oldId, nextId);
        return { ...clue, id: nextId };
      });
      const remapClueId = (id: string) => localClueMap.get(id) ?? id;
      project.published.clues = nextClues;
      project.published.clueIds = project.published.clueIds.map(remapClueId);
      project.published.episode.cues = project.published.episode.cues.map(
        (cue) =>
          cue.sound
            ? { ...cue, sound: { ...cue.sound, clueId: remapClueId(cue.sound.clueId) } }
            : cue,
      );
      project.published.links = project.published.links.map((link) => ({
        ...link,
        requires: link.requires.map(remapClueId),
      }));
      // 草稿同步重写，保证再次发布时引用一致
      project.draft.clues = project.draft.clues.map((clue) => ({
        ...clue,
        id: remapClueId(clue.id),
      }));
      project.draft.cues = project.draft.cues.map((cue) =>
        cue.sound
          ? { ...cue, sound: { ...cue.sound, clueId: remapClueId(cue.sound.clueId) } }
          : cue,
      );
      project.draft.links = project.draft.links.map((link) => ({
        ...link,
        requires: link.requires.map(remapClueId),
      }));
      project.draft.outgoing = project.draft.outgoing.map((choice) => ({
        ...choice,
        requires: choice.requires.map(remapClueId),
      }));

      project.published.scene = {
        ...project.published.scene,
        id: newSceneId,
        choices: project.published.scene.choices.map((choice) => ({
          ...choice,
          requires: choice.requires.map(remapClueId),
          target:
            choice.target === oldSceneId ? newSceneId : choice.target,
        })),
      };
      project.published.episode = {
        ...project.published.episode,
        id: `${newSceneId}-normal`,
        sceneId: newSceneId,
        audio: mappedAsset
          ? `${MEDIA_PROTOCOL}${mappedAsset}`
          : project.published.episode.audio,
      };
      for (const link of project.published.links)
        if (link.fromSceneId === oldSceneId) link.fromSceneId = newSceneId;
    }
    return project;
  });

  // 第三遍：用场景映射重写草稿中的跨项目引用（内建场景 id 不在映射中，保持不变）
  for (const project of cloned) {
    for (const choice of project.draft.outgoing)
      choice.target = sceneMap.get(choice.target) ?? choice.target;
    for (const link of project.draft.links)
      link.fromSceneId = sceneMap.get(link.fromSceneId) ?? link.fromSceneId;
    await putProject(project);
  }
  return { projects: cloned, sceneMap, clueMap: globalClueMap };
}

/** 按场景 / 线索 / 音源 id 映射重写存档，使导入的旧存档指向本机新创作 */
export function remapSnapshot(
  snapshot: CaseSnapshot,
  sceneMap: Map<string, string>,
  clueMap: Map<string, string>,
  episodeMap: Map<string, string>,
): CaseSnapshot {
  const sceneId = (id: string) => sceneMap.get(id) ?? id;
  const clueId = (id: string) => clueMap.get(id) ?? id;
  return {
    ...snapshot,
    story: {
      ...snapshot.story,
      sceneId: sceneId(snapshot.story.sceneId),
      visited: snapshot.story.visited.map(sceneId),
      decisions: snapshot.story.decisions.map((d) => ({
        ...d,
        sceneId: sceneId(d.sceneId),
      })),
    },
    evidence: {
      ...snapshot.evidence,
      clues: snapshot.evidence.clues.map(clueId),
      notes: snapshot.evidence.notes.map((note) => ({
        ...note,
        clueId: note.clueId ? clueId(note.clueId) : null,
        anchor: {
          ...note.anchor,
          sceneId: sceneId(note.anchor.sceneId),
        },
      })),
    },
    heard: Object.fromEntries(
      Object.entries(snapshot.heard).map(([id, pos]) => [
        episodeMap.get(id) ?? id,
        pos,
      ]),
    ),
    resume: {
      ...snapshot.resume,
      sceneId: sceneId(snapshot.resume.sceneId),
    },
  };
}

/** 从导入结果构建音源 id 映射（键为导出文件中的旧 episode id） */
export function buildEpisodeMap(
  sourceProjects: StudioProject[],
  sceneMap: Map<string, string>,
) {
  const episodeMap = new Map<string, string>();
  for (const [oldSceneId] of sceneMap)
    episodeMap.set(`${oldSceneId}-normal`, `${sceneMap.get(oldSceneId)}-normal`);
  void sourceProjects;
  return episodeMap;
}

export function assertCasePack(input: unknown): CasePack {
  if (!input || typeof input !== "object")
    throw new Error("导入文件格式无效");
  const p = input as Record<string, unknown>;
  if (p.format !== "midnight-frequency-case")
    throw new Error("不是雾港案件导出文件");
  return p as unknown as CasePack;
}

export async function importCasePackStudio(
  pack: CasePack,
): Promise<{
  projects: StudioProject[];
  remappedSlot: SaveSlot;
}> {
  if (!pack.studio)
    return { projects: [], remappedSlot: pack.slot };
  const result = await importBundle(pack.studio);
  const episodeMap = buildEpisodeMap(pack.studio.projects, result.sceneMap);
  const remappedSnapshot = remapSnapshot(
    pack.slot.snapshot,
    result.sceneMap,
    result.clueMap,
    episodeMap,
  );
  return {
    projects: result.projects,
    remappedSlot: { ...pack.slot, snapshot: remappedSnapshot },
  };
}
