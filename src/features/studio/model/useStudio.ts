import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MediaAssetMeta,
  StudioProject,
  ValidationIssue,
} from "../../../shared/types";
import {
  allProjects,
  deleteProject as dbDeleteProject,
  getMedia,
  putProject,
} from "../lib/mediaDb";
import { createProject } from "./draft";
import {
  buildPublished,
  isStudioScene,
} from "./publish";
import {
  findUnreachable,
  validateDraft,
  type ValidationContext,
} from "./validation";
import { CASE_CONTENT } from "../../story";

export interface PublishCheck {
  issues: ValidationIssue[];
  unreachable: string[];
}

export const DRAFT_PERSIST_DELAY = 500;

export function useStudio() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectsRef = useRef<StudioProject[]>([]);
  projectsRef.current = projects;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const persisted = useRef(new Map<string, StudioProject>());

  useEffect(() => {
    let cancelled = false;
    allProjects()
      .then((rows) => {
        if (!cancelled) {
          rows.forEach((row) => persisted.current.set(row.id, row));
          setProjects(rows);
          setReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "创作区本地存储无法读取",
          );
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  /** 立即落库（新建、发布等关键路径）：失败时抛出，调用方提示且状态不变 */
  const saveProject = useCallback(async (project: StudioProject) => {
    const timer = timers.current.get(project.id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(project.id);
    }
    await putProject(project);
    persisted.current.set(project.id, project);
    setProjects((prev) =>
      prev.some((p) => p.id === project.id)
        ? prev.map((p) => (p.id === project.id ? project : p))
        : [project, ...prev],
    );
  }, []);

  /** 防抖落库；写入失败（如超额）时把内存回滚到上一份已持久化版本 */
  const schedulePersist = useCallback((project: StudioProject) => {
    const oldTimer = timers.current.get(project.id);
    if (oldTimer) clearTimeout(oldTimer);
    timers.current.set(
      project.id,
      setTimeout(() => {
        timers.current.delete(project.id);
        putProject(project)
          .then(() => persisted.current.set(project.id, project))
          .catch((e) => {
            const last = persisted.current.get(project.id);
            if (last)
              setProjects((prev) =>
                prev.map((p) => (p.id === project.id ? last : p)),
              );
            setError(
              e instanceof Error
                ? `草稿保存失败，已保留上一版本：${e.message}`
                : "草稿保存失败，已保留上一版本",
            );
          });
      }, DRAFT_PERSIST_DELAY),
    );
  }, []);

  const newProject = useCallback(async () => {
    const project = createProject();
    await saveProject(project);
    return project;
  }, [saveProject]);

  /** 草稿编辑：内存即时生效（拖动不卡顿），随后防抖持久化 */
  const updateDraft = useCallback(
    (
      projectId: string,
      fn: (draft: StudioProject["draft"]) => StudioProject["draft"],
    ) => {
      const current = projectsRef.current.find((p) => p.id === projectId);
      if (!current) throw new Error("创作项目不存在");
      const next: StudioProject = { ...current, draft: fn(current.draft) };
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? next : p)),
      );
      schedulePersist(next);
    },
    [schedulePersist],
  );

  /** 立即把当前草稿落库（关键操作后调用，避免防抖窗口内刷新丢失） */
  const flushDraft = useCallback(
    async (projectId: string) => {
      const current = projectsRef.current.find((p) => p.id === projectId);
      if (!current) return;
      await saveProject(current);
    },
    [saveProject],
  );

  const removeProject = useCallback(async (projectId: string) => {
    const timer = timers.current.get(projectId);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(projectId);
    }
    await dbDeleteProject(projectId);
    persisted.current.delete(projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }, []);

  /** 导入的项目已写入 IndexedDB，这里仅并入内存状态（全部是新 ID，不会覆盖） */
  const absorb = useCallback((imported: StudioProject[]) => {
    imported.forEach((p) => persisted.current.set(p.id, p));
    setProjects((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      return [...imported.filter((p) => !ids.has(p.id)), ...prev];
    });
  }, []);

  const checkPublish = useCallback(
    (projectId: string): PublishCheck => {
      const current = projectsRef.current.find((p) => p.id === projectId);
      if (!current) throw new Error("创作项目不存在");
      const ctx: ValidationContext = {
        base: CASE_CONTENT,
        projects: projectsRef.current,
      };
      const sceneId =
        current.published?.scene.id ??
        `custom-${projectId.slice(0, 8)}`;
      const issues = validateDraft(current.draft, ctx, projectId, sceneId);
      const unreachable = findUnreachable(ctx, [
        { projectId, sceneId, draft: current.draft },
      ]);
      return { issues, unreachable };
    },
    [],
  );

  const publish = useCallback(
    async (projectId: string, ctx: ValidationContext) => {
      const current = projectsRef.current.find((p) => p.id === projectId);
      if (!current) throw new Error("创作项目不存在");
      const sceneId =
        current.published?.scene.id ??
        `custom-${projectId.slice(0, 8)}`;
      const issues = validateDraft(current.draft, ctx, projectId, sceneId);
      if (issues.some((i) => i.level === "error"))
        throw new Error("还有阻断性问题未修复，无法发布");
      const unreachable = findUnreachable(ctx, [
        { projectId, sceneId, draft: current.draft },
      ]);
      if (unreachable.includes(sceneId))
        throw new Error("该场景没有可达入口，无法发布");
      const published = buildPublished(
        current.draft,
        current.published,
        Date.now(),
      );
      await saveProject({ ...current, status: "published", published });
    },
    [saveProject],
  );

  /** 取消发布：保留发布快照，运行时内容仍合并它，当前调查与旧存档不受影响 */
  const unpublish = useCallback(
    async (projectId: string) => {
      const current = projectsRef.current.find((p) => p.id === projectId);
      if (!current || !current.published) return;
      await saveProject({ ...current, status: "draft" });
    },
    [saveProject],
  );

  return {
    projects,
    ready,
    error,
    setError,
    newProject,
    updateDraft,
    flushDraft,
    removeProject,
    absorb,
    publish,
    unpublish,
    checkPublish,
    saveProject,
  };
}

export type StudioController = ReturnType<typeof useStudio>;

// ---- media:// 音频解析（会话级 ObjectURL 缓存） ----
const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export async function resolveMediaUrl(assetId: string): Promise<string> {
  const cached = urlCache.get(assetId);
  if (cached) return cached;
  const inflight = pending.get(assetId);
  if (inflight) return inflight;
  const task = (async () => {
    const record = await getMedia(assetId);
    if (!record) throw new Error("录音文件已从本地音频库丢失");
    const url = URL.createObjectURL(record.blob);
    urlCache.set(assetId, url);
    pending.delete(assetId);
    return url;
  })();
  pending.set(assetId, task);
  return task;
}

export function isCustomSceneId(id: string): boolean {
  return isStudioScene(id);
}

export type { MediaAssetMeta };
