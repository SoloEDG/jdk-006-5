import type {
  DraftCue,
  DraftMediaRef,
  OutgoingChoice,
  SceneLink,
  StudioDraft,
  StudioProject,
  CustomClue,
} from "../../../shared/types";
import { newId } from "../../../shared/time";

export const BUILTIN_SCENE_IDS = [
  "arrival",
  "harbor",
  "interview",
  "tower",
  "finale",
] as const;

export function createEmptyDraft(): StudioDraft {
  return {
    title: "",
    location: "",
    description: "",
    media: null,
    cues: [],
    links: [],
    outgoing: [],
    clues: [],
    updatedAt: Date.now(),
  };
}

export function createProject(): StudioProject {
  return {
    id: newId(),
    status: "draft",
    draft: createEmptyDraft(),
    published: null,
    createdAt: Date.now(),
  };
}

export function touch(draft: StudioDraft): StudioDraft {
  return { ...draft, updatedAt: Date.now() };
}

// ---- 字幕句 ----
export function addCue(draft: StudioDraft, at = 0): StudioDraft {
  const duration = draft.media?.duration ?? 0;
  const start = Math.max(0, Math.min(at, Math.max(0, duration - 1)));
  const end = Math.min(duration, start + 2);
  const cue: DraftCue = {
    id: newId(),
    start,
    end: end > start ? end : Math.min(duration, start + 0.5),
    speaker: "",
    text: "",
    sound: null,
    stale: false,
  };
  const cues = [...draft.cues, cue].sort((a, b) => a.start - b.start);
  return touch({ ...draft, cues });
}

export function updateCue(
  draft: StudioDraft,
  cueId: string,
  patch: Partial<Omit<DraftCue, "id">>,
): StudioDraft {
  return touch({
    ...draft,
    cues: draft.cues.map((cue) =>
      cue.id === cueId ? { ...cue, ...patch, stale: false } : cue,
    ),
  });
}

export function removeCue(draft: StudioDraft, cueId: string): StudioDraft {
  return touch({
    ...draft,
    cues: draft.cues.filter((cue) => cue.id !== cueId),
  });
}

// ---- 声音线索定义 ----
export function addClue(draft: StudioDraft): StudioDraft {
  const clue: CustomClue = {
    id: `custom-clue-${newId().slice(0, 8)}`,
    title: "",
    kind: "环境声音",
    description: "",
  };
  return touch({ ...draft, clues: [...draft.clues, clue] });
}

export function updateClue(
  draft: StudioDraft,
  clueId: string,
  patch: Partial<Omit<CustomClue, "id">>,
): StudioDraft {
  return touch({
    ...draft,
    clues: draft.clues.map((clue) =>
      clue.id === clueId ? { ...clue, ...patch } : clue,
    ),
  });
}

export function removeClue(draft: StudioDraft, clueId: string): StudioDraft {
  return touch({
    ...draft,
    clues: draft.clues.filter((clue) => clue.id !== clueId),
    // 同步清掉引用该线索的声音窗口
    cues: draft.cues.map((cue) =>
      cue.sound?.clueId === clueId ? { ...cue, sound: null } : cue,
    ),
  });
}

// ---- 入口（接到已有调查方向）----
export function addLink(draft: StudioDraft, fromSceneId: string): StudioDraft {
  const link: SceneLink = {
    id: newId(),
    fromSceneId,
    label: "",
    description: "",
    requires: [],
  };
  return touch({ ...draft, links: [...draft.links, link] });
}

export function updateLink(
  draft: StudioDraft,
  linkId: string,
  patch: Partial<Omit<SceneLink, "id">>,
): StudioDraft {
  return touch({
    ...draft,
    links: draft.links.map((link) =>
      link.id === linkId ? { ...link, ...patch } : link,
    ),
  });
}

export function removeLink(draft: StudioDraft, linkId: string): StudioDraft {
  return touch({
    ...draft,
    links: draft.links.filter((link) => link.id !== linkId),
  });
}

// ---- 新场景自身的后续方向 ----
export function addOutgoing(draft: StudioDraft, target: string): StudioDraft {
  const choice: OutgoingChoice = {
    id: newId(),
    label: "",
    target,
    requires: [],
    description: "",
  };
  return touch({ ...draft, outgoing: [...draft.outgoing, choice] });
}

export function updateOutgoing(
  draft: StudioDraft,
  choiceId: string,
  patch: Partial<Omit<OutgoingChoice, "id">>,
): StudioDraft {
  return touch({
    ...draft,
    outgoing: draft.outgoing.map((choice) =>
      choice.id === choiceId ? { ...choice, ...patch } : choice,
    ),
  });
}

export function removeOutgoing(
  draft: StudioDraft,
  choiceId: string,
): StudioDraft {
  return touch({
    ...draft,
    outgoing: draft.outgoing.filter((choice) => choice.id !== choiceId),
  });
}

/**
 * 替换草稿音频：文字（说话人、字幕、线索定义）全部保留，
 * 任何超出新时长的时间点标记 stale，等待人工确认后才重新生效。
 */
export function replaceMedia(
  draft: StudioDraft,
  media: DraftMediaRef,
): StudioDraft {
  const cues = draft.cues.map((cue) => {
    const stale =
      cue.start >= media.duration ||
      cue.end > media.duration ||
      cue.start < 0;
    const soundStale = cue.sound
      ? cue.sound.start >= media.duration ||
        cue.sound.end > media.duration
      : false;
    return { ...cue, stale: stale || soundStale };
  });
  return touch({ ...draft, media, cues });
}

/** 人工确认失效时间点：把超出时长的点收回到新时长内并解除失效标记 */
export function confirmStaleCue(
  draft: StudioDraft,
  cueId: string,
): StudioDraft {
  const duration = draft.media?.duration ?? 0;
  return touch({
    ...draft,
    cues: draft.cues.map((cue) => {
      if (cue.id !== cueId || !cue.stale) return cue;
      const start = Math.min(cue.start, Math.max(0, duration - 0.5));
      const end = Math.min(Math.max(cue.end, start + 0.1), duration);
      const sound = cue.sound
        ? {
            ...cue.sound,
            start: Math.min(cue.sound.start, Math.max(0, duration - 0.5)),
            end: Math.min(
              Math.max(cue.sound.end, cue.sound.start + 0.1),
              duration,
            ),
          }
        : null;
      return { ...cue, start, end, sound, stale: false };
    }),
  });
}

export function confirmAllStale(draft: StudioDraft): StudioDraft {
  return draft.cues
    .filter((cue) => cue.stale)
    .reduce((next, cue) => confirmStaleCue(next, cue.id), draft);
}
