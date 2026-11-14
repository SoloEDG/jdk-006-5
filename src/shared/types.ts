// 场景 id 对内建五场景是固定字面量，对创作区发布的场景为运行时生成的字符串
export type SceneId = string;
export interface Cue {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  sound?: { clueId: string; start: number; end: number; description: string };
}
export interface Episode {
  id: string;
  sceneId: SceneId;
  title: string;
  version: string;
  description: string;
  // 内建场景为 "/audio/*.wav"，创作区录音为 "media://<assetId>"
  audio: string;
  duration: number;
  cues: Cue[];
  wave: number[];
}
export interface ClueDefinition {
  id: string;
  title: string;
  kind: string;
  description: string;
}
export interface Choice {
  id: string;
  label: string;
  target: SceneId;
  requires: string[];
  description: string;
}
export interface Scene {
  id: SceneId;
  title: string;
  location: string;
  chapter: string;
  description: string;
  choices: Choice[];
}
export interface CaseContent {
  id: string;
  title: string;
  scenes: Scene[];
  episodes: Episode[];
  clues: ClueDefinition[];
}
export interface Investigation {
  sceneId: SceneId;
  visited: SceneId[];
  decisions: { sceneId: SceneId; choiceId: string }[];
  ending: string | null;
}
export type HeardHistory = Record<string, number>;
export interface AudioBookmark {
  sceneId: SceneId;
  start: number;
  end: number;
}
export interface EvidenceNote {
  id: string;
  clueId: string | null;
  title: string;
  text: string;
  anchor: AudioBookmark;
  createdAt: number;
  pinned: boolean;
}
export interface EvidenceState {
  notes: EvidenceNote[];
  clues: string[];
  selectedId: string | null;
}
export interface ResumePoint {
  sceneId: SceneId;
  position: number;
  rate: number;
}
export interface CaseSnapshot {
  version: 1;
  caseId: string;
  story: Investigation;
  evidence: EvidenceState;
  heard: HeardHistory;
  resume: ResumePoint;
}
export interface SaveSlot {
  id: string;
  name: string;
  updatedAt: number;
  snapshot: CaseSnapshot;
}
export interface TransportState {
  requestedId: string;
  loadedId: string | null;
  position: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  rate: number;
  volume: number;
  error: string | null;
}
export interface CapturePort {
  captureRange: (sceneId: SceneId, width?: number) => AudioBookmark | null;
}

// ===== 创作区（场景工作室）类型 =====
export type ScenePublishStatus = "draft" | "published";

export interface MediaAssetMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  wave: number[];
  createdAt: number;
}

export interface SoundMarker {
  clueId: string;
  start: number;
  end: number;
  description: string;
}

export interface DraftCue {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  sound: SoundMarker | null;
  // 替换草稿音频后，超出新时长的时间点保留文字但标记失效，等待人工确认
  stale: boolean;
}

export interface SceneLink {
  // 从某个已有场景的调查方向接入新场景
  id: string;
  fromSceneId: SceneId;
  label: string;
  description: string;
  requires: string[];
}

export interface OutgoingChoice {
  // 新场景自身的后续调查方向
  id: string;
  label: string;
  target: SceneId;
  requires: string[];
  description: string;
}

export interface CustomClue {
  id: string;
  title: string;
  kind: string;
  description: string;
}

export interface DraftMediaRef {
  assetId: string;
  name: string;
  duration: number;
  wave: number[];
}

export interface StudioDraft {
  title: string;
  location: string;
  description: string;
  media: DraftMediaRef | null;
  cues: DraftCue[];
  links: SceneLink[];
  outgoing: OutgoingChoice[];
  clues: CustomClue[];
  updatedAt: number;
}

export interface PublishedScene {
  // 一次成功发布的不可变快照，也是取消发布后维持当前调查可用的保留版本
  scene: Scene;
  episode: Episode;
  clues: ClueDefinition[];
  links: SceneLink[];
  mediaAssetId: string;
  publishedAt: number;
  revision: number;
  // 线索定义 id 在发布时保持稳定，这里仅作导入重映射的冗余备份
  clueIds: string[];
}

export interface StudioProject {
  id: string;
  status: ScenePublishStatus;
  draft: StudioDraft;
  published: PublishedScene | null;
  createdAt: number;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code:
    | "media-missing"
    | "meta-missing"
    | "cue-empty"
    | "cue-out-of-bounds"
    | "cue-order"
    | "cue-overlap"
    | "cue-stale"
    | "sound-out-of-bounds"
    | "sound-clue-missing"
    | "sound-empty"
    | "link-missing"
    | "link-scene-missing"
    | "link-clue-missing"
    | "unreachable"
    | "choice-target-missing"
    | "choice-clue-missing"
    | "choice-duplicate";
  message: string;
}

// 导出 / 导入的文件包
export interface StudioMediaPayload {
  id: string;
  name: string;
  mime: string;
  dataBase64: string;
}
export interface StudioBundle {
  format: "midnight-frequency-studio";
  version: 1;
  exportedAt: number;
  projects: StudioProject[];
  media: StudioMediaPayload[];
}
export interface CasePack {
  format: "midnight-frequency-case";
  version: 1;
  exportedAt: number;
  slot: SaveSlot;
  studio: StudioBundle | null;
}
