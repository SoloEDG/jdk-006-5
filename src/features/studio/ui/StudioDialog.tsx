import { useRef, useState } from "react";
import {
  Plus,
  X,
  Upload,
  Download,
  FileAudio,
  CircleDot,
  Eye,
  Trash2,
  LoaderCircle,
} from "lucide-react";
import type { StudioProject } from "../../../shared/types";
import type { StudioController } from "../model/useStudio";
import type { CaseContent } from "../../../shared/types";
import { buildBundle, importBundle } from "../lib/bundle";
import { ProjectEditor } from "./ProjectEditor";

interface Props {
  controller: StudioController;
  runtimeContent: CaseContent;
  onClose: () => void;
}

export function StudioDialog({ controller, runtimeContent, onClose }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(controller.error);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，上一版本仍保留");
      controller.setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  if (editingId) {
    const project = controller.projects.find((p) => p.id === editingId);
    if (project)
      return (
        <ProjectEditor
          project={project}
          controller={controller}
          runtimeContent={runtimeContent}
          onBack={() => setEditingId(null)}
          onClose={onClose}
        />
      );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="场景创作区"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">SCENE STUDIO</span>
            <h2>场景创作区</h2>
            <p>
              草稿与预览完全独立于正在调查的录音，只有发布后的场景才会接入故事。
            </p>
          </div>
          <button className="icon-button" aria-label="关闭创作区" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="studio-toolbar">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const project = await controller.newProject();
                setEditingId(project.id);
              })
            }
          >
            <Plus size={15} /> 新建场景
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const bundle = await buildBundle(controller.projects);
                downloadJson(
                  JSON.stringify(bundle, null, 2),
                  "雾港-创作区.json",
                );
              })
            }
          >
            <Download size={14} /> 导出全部创作
          </button>
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> 导入创作
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              await run(async () => {
                const text = await file.text();
                const { projects: imported } = await importBundle(
                  JSON.parse(text),
                );
                controller.absorb(imported);
              });
            }}
          />
          {busy && <LoaderCircle size={15} className="spin" />}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}

        <div className="studio-project-list">
          {!controller.ready ? (
            <div className="empty-notes">
              <LoaderCircle size={26} className="spin" />
              <p>正在读取本地创作…</p>
            </div>
          ) : controller.projects.length === 0 ? (
            <div className="empty-notes">
              <FileAudio size={28} />
              <p>还没有自创场景</p>
              <small>上传一段本地录音，开始扩展雾港的调查。</small>
            </div>
          ) : (
            controller.projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busy}
                onOpen={() => setEditingId(project.id)}
                onDelete={() => run(() => controller.removeProject(project.id))}
              />
            ))
          )}
        </div>
        <footer className="dialog-footer">
          <span>
            录音保存在本机 IndexedDB，刷新页面仍可播放；导出文件内嵌音频，可在其他设备导入。
          </span>
        </footer>
      </section>
    </div>
  );
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onDelete,
}: {
  project: StudioProject;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const d = project.draft;
  return (
    <article className="studio-card">
      <div className="studio-card-head">
        <span className={`studio-status ${project.status}`}>
          <CircleDot size={11} />
          {project.status === "published" ? "已发布" : "草稿"}
          {project.published ? ` · 第 ${project.published.revision} 版` : ""}
        </span>
        <button
          className="icon-button"
          aria-label="删除创作项目"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <h3>{d.title.trim() || "未命名场景"}</h3>
      <p>
        {d.media ? (
          <>
            <FileAudio size={11} /> {d.media.name} · {d.cues.length} 句字幕 ·{" "}
            {d.clues.length} 条线索 · {d.links.length} 个入口
          </>
        ) : (
          "尚未上传录音"
        )}
      </p>
      <div className="studio-card-actions">
        <button onClick={onOpen}>
          <Eye size={13} /> 打开编辑
        </button>
      </div>
    </article>
  );
}

function downloadJson(text: string, filename: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
