import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Upload,
  RefreshCw,
  Plus,
  Trash2,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  Send,
  Eye,
  X,
  AudioLines,
  Link2,
  Compass,
  Bookmark,
  LoaderCircle,
} from "lucide-react";
import type {
  CaseContent,
  DraftCue,
  StudioDraft,
  StudioProject,
  ValidationIssue,
} from "../../../shared/types";
import type { StudioController } from "../model/useStudio";
import { resolveMediaUrl } from "../model/useStudio";
import {
  addClue,
  addCue,
  addLink,
  addOutgoing,
  confirmAllStale,
  removeClue,
  removeCue,
  removeLink,
  removeOutgoing,
  replaceMedia,
  updateClue,
  updateCue,
  updateLink,
  updateOutgoing,
} from "../model/draft";
import { findUnreachable, validateDraft } from "../model/validation";
import { ingestAudioFile } from "../lib/audio";
import { putMedia } from "../lib/mediaDb";
import { formatTime } from "../../../shared/time";
import { CASE_CONTENT } from "../../story";
import { StudioPreview } from "./StudioPreview";

interface Props {
  project: StudioProject;
  controller: StudioController;
  runtimeContent: CaseContent;
  onBack: () => void;
  onClose: () => void;
}

type Tab = "script" | "clues" | "links" | "check";

export function ProjectEditor({
  project,
  controller,
  runtimeContent,
  onBack,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("script");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const draft = project.draft;
  const mutate = (fn: (d: StudioDraft) => StudioDraft) =>
    controller.updateDraft(project.id, fn);

  const validationCtx = useMemo(
    () => ({ base: CASE_CONTENT, projects: controller.projects }),
    [controller.projects],
  );
  const sceneId =
    project.published?.scene.id ?? `custom-${project.id.slice(0, 8)}`;
  const issues = useMemo(
    () => validateDraft(draft, validationCtx, project.id, sceneId),
    [draft, validationCtx, project.id, sceneId],
  );
  const unreachable = useMemo(
    () =>
      findUnreachable(validationCtx, [
        { projectId: project.id, sceneId, draft },
      ]),
    [validationCtx, project.id, sceneId, draft],
  );
  const blocking = issues.filter((i) => i.level === "error");

  const guard = (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    action()
      .catch((e) =>
        setMessage({
          ok: false,
          text: e instanceof Error ? e.message : "操作失败，已保留上一版本",
        }),
      )
      .finally(() => setBusy(false));
  };

  const onUpload = (file: File, replacing: boolean) =>
    guard(async () => {
      const { record } = await ingestAudioFile(file);
      try {
        // 先写音频库；超额会在这里抛错，草稿与旧录音都不受影响
        await putMedia(record);
      } catch (e) {
        throw new Error(
          `本地存储空间不足，已保留上一份可用录音（${e instanceof Error ? e.message : "写入失败"}）`,
        );
      }
      const media = {
        assetId: record.meta.id,
        name: record.meta.name,
        duration: record.meta.duration,
        wave: record.meta.wave,
      };
      mutate((d) =>
        replacing
          ? replaceMedia(d, media)
          : { ...d, media, updatedAt: Date.now() },
      );
      // 关键操作立即落库，不等待防抖
      await controller.flushDraft(project.id);
      setMessage({
        ok: true,
        text: replacing
          ? "录音已替换，文字全部保留；超出新时长的时间点标记为待确认。"
          : "录音已上传，波形生成完成。",
      });
    });

  if (preview)
    return (
      <StudioPreview
        draft={draft}
        title={project.published?.scene.title ?? draft.title}
        onClose={() => setPreview(false)}
      />
    );

  return (
    <div className="modal-backdrop">
      <section className="studio-editor" role="dialog" aria-modal="true">
        <header className="editor-header">
          <div>
            <button className="back-link" onClick={onBack}>
              <ArrowLeft size={14} /> 创作区
            </button>
            <h2>{draft.title.trim() || "未命名场景"}</h2>
            <p>
              {project.status === "published"
                ? `已发布 · 第 ${project.published?.revision ?? 1} 版 · 修改草稿并重新发布才会更新故事`
                : "草稿不会出现在调查中，发布前可反复预览。"}
            </p>
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="editor-tabs">
          {(
            [
              ["script", "字幕与录音"],
              ["clues", "声音线索"],
              ["links", "入口与后续"],
              ["check", "发布检查"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "check" && blocking.length > 0 && (
                <span className="tab-badge">{blocking.length}</span>
              )}
            </button>
          ))}
        </div>

        {message && (
          <p className={`studio-message ${message.ok ? "ok" : "err"}`} role="status">
            {message.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {message.text}
          </p>
        )}

        <div className="editor-body">
          {tab === "script" && (
            <ScriptTab
              draft={draft}
              busy={busy}
              fileRef={fileRef}
              replaceRef={replaceRef}
              onUpload={onUpload}
              mutate={mutate}
            />
          )}
          {tab === "clues" && (
            <CluesTab draft={draft} mutate={mutate} />
          )}
          {tab === "links" && (
            <LinksTab
              draft={draft}
              content={runtimeContent}
              sceneId={sceneId}
              mutate={mutate}
            />
          )}
          {tab === "check" && (
            <CheckTab
              issues={issues}
              unreachable={unreachable}
              sceneId={sceneId}
              draft={draft}
            />
          )}
        </div>

        <footer className="editor-footer">
          <div className="editor-footer-note">
            {project.status === "published"
              ? "取消发布不影响当前调查：保留版本仍可收听，只是不再出现新入口。"
              : "编辑中的草稿与正在调查的录音完全隔离。"}
          </div>
          <button
            disabled={!draft.media || busy}
            onClick={() => setPreview(true)}
          >
            <Eye size={14} /> 草稿预览
          </button>
          {project.published && (
            <button
              disabled={busy}
              onClick={() =>
                guard(async () => {
                  await controller.unpublish(project.id);
                  setMessage({ ok: true, text: "已取消发布，当前调查与旧存档不受影响。" });
                })
              }
            >
              取消发布
            </button>
          )}
          <button
            className="primary-button"
            disabled={busy || blocking.length > 0 || unreachable.includes(sceneId)}
            onClick={() =>
              guard(async () => {
                await controller.publish(project.id, validationCtx);
                setMessage({ ok: true, text: "场景已发布，并接入所选调查方向。" });
                setTab("check");
              })
            }
          >
            <Send size={14} /> {project.published ? "重新发布" : "发布场景"}
          </button>
        </footer>
      </section>
    </div>
  );
}

// ---------- 字幕与录音 ----------
function ScriptTab({
  draft,
  busy,
  fileRef,
  replaceRef,
  onUpload,
  mutate,
}: {
  draft: StudioDraft;
  busy: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  replaceRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (file: File, replacing: boolean) => void;
  mutate: (fn: (d: StudioDraft) => StudioDraft) => void;
}) {
  const hasStale = draft.cues.some((c) => c.stale);
  return (
    <div className="script-tab">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(f, false);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(f, true);
        }}
      />
      {!draft.media ? (
        <button
          className="upload-drop"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={26} />
          <strong>上传本地录音</strong>
          <small>支持 wav / mp3 / m4a / ogg，上传后自动生成波形</small>
          {busy && <LoaderCircle size={16} className="spin" />}
        </button>
      ) : (
        <>
          <StudioPlayer draft={draft} />
          <div className="script-toolbar">
            <button
              disabled={busy}
              onClick={() => replaceRef.current?.click()}
            >
              <RefreshCw size={13} /> 替换草稿音频
            </button>
            <button onClick={() => mutate((d) => addCue(d))}>
              <Plus size={13} /> 添加字幕句
            </button>
            {hasStale && (
              <button
                className="warn-button"
                onClick={() => mutate((d) => confirmAllStale(d))}
              >
                <AlertTriangle size={13} /> 一键确认失效时间点（
                {draft.cues.filter((c) => c.stale).length}）
              </button>
            )}
          </div>
          <div className="cue-editor-list">
            {[...draft.cues]
              .sort((a, b) => a.start - b.start)
              .map((cue, index) => (
                <CueEditor
                  key={cue.id}
                  cue={cue}
                  index={index}
                  duration={draft.media!.duration}
                  clueOptions={draft.clues}
                  onChange={(patch) =>
                    mutate((d) => updateCue(d, cue.id, patch))
                  }
                  onRemove={() => mutate((d) => removeCue(d, cue.id))}
                  onSeekHint={(t) => window.dispatchEvent(
                    new CustomEvent("studio-seek", { detail: t }),
                  )}
                />
              ))}
            {draft.cues.length === 0 && (
              <p className="empty-small">
                还没有字幕句。点击「添加字幕句」，再在波形上拖出每句的起止点。
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CueEditor({
  cue,
  index,
  duration,
  clueOptions,
  onChange,
  onRemove,
  onSeekHint,
}: {
  cue: DraftCue;
  index: number;
  duration: number;
  clueOptions: StudioDraft["clues"];
  onChange: (patch: Partial<DraftCue>) => void;
  onRemove: () => void;
  onSeekHint: (t: number) => void;
}) {
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = Math.min(
        duration,
        Math.max(0, ((e.clientX - rect.left) / rect.width) * duration),
      );
      if (drag === "start")
        onChange({ start: Math.min(t, cue.end - 0.05), stale: false });
      else onChange({ end: Math.max(t, cue.start + 0.05), stale: false });
    };
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, cue.start, cue.end, duration, onChange]);

  return (
    <article className={`cue-editor ${cue.stale ? "stale" : ""}`}>
      <div className="cue-editor-head">
        <span className="cue-index">#{index + 1}</span>
        {cue.stale && (
          <span className="stale-tag">
            <AlertTriangle size={11} /> 时间点失效，等待确认
          </span>
        )}
        <button className="icon-button" aria-label="删除字幕句" onClick={onRemove}>
          <Trash2 size={13} />
        </button>
      </div>
      <div
        className="cue-range-track"
        ref={trackRef}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeekHint(
            ((e.clientX - rect.left) / rect.width) * duration,
          );
        }}
      >
        <span
          className="cue-range-window"
          style={{ left: pct(cue.start), width: pct(cue.end - cue.start) }}
        />
        <span
          className="range-handle start"
          style={{ left: pct(cue.start) }}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDrag("start");
          }}
        />
        <span
          className="range-handle end"
          style={{ left: pct(cue.end) }}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDrag("end");
          }}
        />
      </div>
      <div className="cue-time-row">
        <label>
          起
          <input
            type="number"
            min={0}
            max={duration}
            step={0.05}
            value={round(cue.start)}
            onChange={(e) =>
              onChange({
                start: clamp(
                  Math.min(Number(e.target.value), cue.end - 0.05),
                  0,
                  duration,
                ),
                stale: false,
              })
            }
          />
        </label>
        <label>
          止
          <input
            type="number"
            min={0}
            max={duration}
            step={0.05}
            value={round(cue.end)}
            onChange={(e) =>
              onChange({
                end: clamp(
                  Math.max(Number(e.target.value), cue.start + 0.05),
                  0,
                  duration,
                ),
                stale: false,
              })
            }
          />
        </label>
        <span className="cue-time-text">
          {formatTime(cue.start)} — {formatTime(cue.end)}
        </span>
      </div>
      <div className="cue-input-row">
        <input
          aria-label="说话人"
          placeholder="说话人，如：林岚"
          value={cue.speaker}
          onChange={(e) => onChange({ speaker: e.target.value })}
        />
        <textarea
          aria-label="字幕文字"
          placeholder="字幕文字…"
          rows={2}
          value={cue.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      </div>
      <SoundWindowEditor cue={cue} duration={duration} clueOptions={clueOptions} onChange={onChange} />
    </article>
  );
}

function SoundWindowEditor({
  cue,
  duration,
  clueOptions,
  onChange,
}: {
  cue: DraftCue;
  duration: number;
  clueOptions: StudioDraft["clues"];
  onChange: (patch: Partial<DraftCue>) => void;
}) {
  if (!cue.sound)
    return (
      <button
        className="add-sound"
        onClick={() =>
          onChange({
            sound: {
              clueId: clueOptions[0]?.id ?? "",
              start: cue.start,
              end: Math.min(cue.end, cue.start + 1.5),
              description: "",
            },
          })
        }
      >
        <AudioLines size={12} /> 添加声音线索窗口
      </button>
    );
  const sound = cue.sound;
  return (
    <div className="sound-editor">
      <div className="sound-editor-head">
        <AudioLines size={12} />
        <strong>声音线索窗口</strong>
        <button onClick={() => onChange({ sound: null })}>
          <X size={12} /> 移除
        </button>
      </div>
      <div className="cue-time-row">
        <label>
          线索
          <select
            value={sound.clueId}
            onChange={(e) =>
              onChange({ sound: { ...sound, clueId: e.target.value } })
            }
          >
            {clueOptions.length === 0 && <option value="">请先在线索页定义</option>}
            {clueOptions.map((clue) => (
              <option key={clue.id} value={clue.id}>
                {clue.title || "未命名线索"}
              </option>
            ))}
          </select>
        </label>
        <label>
          起
          <input
            type="number"
            min={cue.start}
            max={cue.end}
            step={0.05}
            value={round(sound.start)}
            onChange={(e) =>
              onChange({
                sound: {
                  ...sound,
                  start: clamp(
                    Number(e.target.value),
                    cue.start,
                    sound.end - 0.05,
                  ),
                },
              })
            }
          />
        </label>
        <label>
          止
          <input
            type="number"
            min={cue.start}
            max={cue.end}
            step={0.05}
            value={round(sound.end)}
            onChange={(e) =>
              onChange({
                sound: {
                  ...sound,
                  end: clamp(
                    Number(e.target.value),
                    sound.start + 0.05,
                    cue.end,
                  ),
                },
              })
            }
          />
        </label>
      </div>
      <input
        aria-label="声音描述"
        placeholder="声音描述，如：三声金属钟响"
        value={sound.description}
        onChange={(e) =>
          onChange({ sound: { ...sound, description: e.target.value } })
        }
      />
      <small>窗口需保持在本句字幕范围内（0 — {round(duration)} 秒）。</small>
    </div>
  );
}

// ---------- 声音线索定义 ----------
function CluesTab({
  draft,
  mutate,
}: {
  draft: StudioDraft;
  mutate: (fn: (d: StudioDraft) => StudioDraft) => void;
}) {
  return (
    <div className="clues-tab">
      <p className="tab-hint">
        <Bookmark size={13} /> 先定义本场景可收集的声音线索，再回到字幕页挂到具体句子上。
      </p>
      <button onClick={() => mutate((d) => addClue(d))}>
        <Plus size={13} /> 新建线索
      </button>
      <div className="clue-editor-list">
        {draft.clues.map((clue) => (
          <article key={clue.id} className="clue-editor">
            <input
              aria-label="线索标题"
              placeholder="线索标题，如：码头回声"
              value={clue.title}
              onChange={(e) =>
                mutate((d) => updateClue(d, clue.id, { title: e.target.value }))
              }
            />
            <div className="cue-time-row">
              <label>
                类型
                <select
                  value={clue.kind}
                  onChange={(e) =>
                    mutate((d) =>
                      updateClue(d, clue.id, { kind: e.target.value }),
                    )
                  }
                >
                  {["环境声音", "背景声音", "录音证词", "人声线索"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <button
                className="danger"
                onClick={() => mutate((d) => removeClue(d, clue.id))}
              >
                <Trash2 size={12} /> 删除线索
              </button>
            </div>
            <textarea
              aria-label="线索描述"
              placeholder="线索描述…"
              rows={2}
              value={clue.description}
              onChange={(e) =>
                mutate((d) =>
                  updateClue(d, clue.id, { description: e.target.value }),
                )
              }
            />
          </article>
        ))}
      </div>
    </div>
  );
}

// ---------- 入口与后续 ----------
function LinksTab({
  draft,
  content,
  sceneId,
  mutate,
}: {
  draft: StudioDraft;
  content: CaseContent;
  sceneId: string;
  mutate: (fn: (d: StudioDraft) => StudioDraft) => void;
}) {
  const linkableScenes = content.scenes.filter((s) => s.id !== sceneId);
  const targetScenes = content.scenes;
  const allClues = content.clues;
  return (
    <div className="links-tab">
      <section>
        <h3>
          <Link2 size={14} /> 接入口（从已有调查方向进入本场景）
        </h3>
        <p className="tab-hint">
          每个入口会在来源场景的「下一步调查」中出现；至少保留一个可达入口才能发布。
        </p>
        <button
          onClick={() =>
            mutate((d) => addLink(d, linkableScenes[0]?.id ?? "arrival"))
          }
        >
          <Plus size={13} /> 添加入口
        </button>
        {draft.links.map((link) => (
          <article key={link.id} className="link-editor">
            <div className="cue-time-row">
              <label>
                来源场景
                <select
                  value={link.fromSceneId}
                  onChange={(e) =>
                    mutate((d) =>
                      updateLink(d, link.id, { fromSceneId: e.target.value }),
                    )
                  }
                >
                  {linkableScenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <RequiresPicker
                requires={link.requires}
                clues={allClues}
                onChange={(requires) =>
                  mutate((d) => updateLink(d, link.id, { requires }))
                }
              />
              <button
                className="danger"
                onClick={() => mutate((d) => removeLink(d, link.id))}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              placeholder="调查方向名称，如：追查录音里的第二个人"
              value={link.label}
              onChange={(e) =>
                mutate((d) => updateLink(d, link.id, { label: e.target.value }))
              }
            />
            <input
              placeholder="方向描述（可选）"
              value={link.description}
              onChange={(e) =>
                mutate((d) =>
                  updateLink(d, link.id, { description: e.target.value }),
                )
              }
            />
          </article>
        ))}
      </section>
      <section>
        <h3>
          <Compass size={14} /> 本场景的后续调查方向
        </h3>
        <p className="tab-hint">玩家听完本场景后可以前往的已有场景。</p>
        <button
          onClick={() =>
            mutate((d) => addOutgoing(d, targetScenes[0]?.id ?? "arrival"))
          }
        >
          <Plus size={13} /> 添加后续方向
        </button>
        {draft.outgoing.map((choice) => (
          <article key={choice.id} className="link-editor">
            <div className="cue-time-row">
              <label>
                前往场景
                <select
                  value={choice.target}
                  onChange={(e) =>
                    mutate((d) =>
                      updateOutgoing(d, choice.id, { target: e.target.value }),
                    )
                  }
                >
                  {targetScenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <RequiresPicker
                requires={choice.requires}
                clues={allClues}
                onChange={(requires) =>
                  mutate((d) =>
                    updateOutgoing(d, choice.id, { requires }),
                  )
                }
              />
              <button
                className="danger"
                onClick={() => mutate((d) => removeOutgoing(d, choice.id))}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              placeholder="方向名称，如：带着录音回电台"
              value={choice.label}
              onChange={(e) =>
                mutate((d) =>
                  updateOutgoing(d, choice.id, { label: e.target.value }),
                )
              }
            />
            <input
              placeholder="方向描述（可选）"
              value={choice.description}
              onChange={(e) =>
                mutate((d) =>
                  updateOutgoing(d, choice.id, { description: e.target.value }),
                )
              }
            />
          </article>
        ))}
      </section>
    </div>
  );
}

function RequiresPicker({
  requires,
  clues,
  onChange,
}: {
  requires: string[];
  clues: CaseContent["clues"];
  onChange: (requires: string[]) => void;
}) {
  return (
    <label className="requires-picker">
      需要线索
      <select
        value=""
        onChange={(e) => {
          const id = e.target.value;
          if (id && !requires.includes(id)) onChange([...requires, id]);
        }}
      >
        <option value="">添加线索门槛…</option>
        {clues
          .filter((c) => !requires.includes(c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
      </select>
      <div className="requires-chips">
        {requires.map((id) => (
          <span key={id} className="require-chip">
            {clues.find((c) => c.id === id)?.title ?? id}
            <button
              aria-label="移除门槛"
              onClick={() => onChange(requires.filter((r) => r !== id))}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
    </label>
  );
}

// ---------- 发布检查 ----------
function CheckTab({
  issues,
  unreachable,
  sceneId,
  draft,
}: {
  issues: ValidationIssue[];
  unreachable: string[];
  sceneId: string;
  draft: StudioDraft;
}) {
  const all: ValidationIssue[] = [
    ...issues,
    ...(unreachable.includes(sceneId)
      ? [
          {
            level: "error" as const,
            code: "unreachable" as const,
            message:
              "该场景没有可达入口：请在「入口与后续」中把它接到一个从序章可达的场景上。",
          },
        ]
      : []),
  ];
  const errors = all.filter((i) => i.level === "error");
  const warnings = all.filter((i) => i.level === "warning");
  return (
    <div className="check-tab">
      <div className="check-summary">
        {errors.length === 0 ? (
          <p className="ok">
            <CheckCircle2 size={16} />
            全部硬性检查通过{warnings.length ? `，另有 ${warnings.length} 条提醒` : ""}，可以发布。
          </p>
        ) : (
          <p className="err">
            <AlertTriangle size={16} />
            {errors.length} 个问题阻断发布，请先修复。
          </p>
        )}
        <small>
          检查项：字幕越界、声音线索缺失、入口可达性、时间点失效、线索门槛引用。
        </small>
      </div>
      <ul className="issue-list">
        {all.map((issue, i) => (
          <li key={i} className={issue.level}>
            {issue.level === "error" ? (
              <AlertTriangle size={13} />
            ) : (
              <AlertTriangle size={13} className="warn-icon" />
            )}
            {issue.message}
          </li>
        ))}
        {all.length === 0 && (
          <li className="ok">
            <CheckCircle2 size={13} /> 草稿完整：{draft.cues.length} 句字幕、
            {draft.links.length} 个入口。
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------- 创作区独立播放器（与调查播放互不影响） ----------
function StudioPlayer({ draft }: { draft: StudioDraft }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(draft.media!.duration);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setLoadError(false);
    resolveMediaUrl(draft.media!.assetId)
      .then((u) => {
        if (revoked) return;
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (!revoked) setLoadError(true);
      });
    const onSeek = (e: Event) => {
      const audio = audioRef.current;
      if (audio) audio.currentTime = (e as CustomEvent<number>).detail;
    };
    window.addEventListener("studio-seek", onSeek);
    return () => {
      revoked = true;
      window.removeEventListener("studio-seek", onSeek);
      // 会话级缓存 URL 供调查播放复用，这里不 revoke
      void objectUrl;
    };
  }, [draft.media!.assetId]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  return (
    <div className="studio-player">
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => url && setLoadError(true)}
      />
      {loadError && (
        <p className="inline-error" role="alert">
          录音无法读取，可能本地文件已丢失；请重新上传或从创作区文件导入。
        </p>
      )}
      <div className="studio-wave">
        {draft.media!.wave.map((v, i) => (
          <i
            key={i}
            className={
              i / draft.media!.wave.length <=
              position / (duration || draft.media!.duration)
                ? "played"
                : ""
            }
            style={{ height: `${Math.max(6, Math.min(46, v * 38))}px` }}
          />
        ))}
        <span
          className="playhead"
          style={{
            left: `${(position / (duration || draft.media!.duration)) * 100}%`,
          }}
        />
        {[...draft.cues]
          .sort((a, b) => a.start - b.start)
          .map((cue) => (
            <span
              key={cue.id}
              className={`cue-marker ${cue.stale ? "stale" : ""}`}
              title={`${cue.speaker || "?"}：${cue.text || "未填写"}`}
              style={{ left: `${(cue.start / duration) * 100}%` }}
            />
          ))}
      </div>
      <div className="studio-player-controls">
        <button onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span>
          {formatTime(position)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={position}
          aria-label="草稿录音进度"
          onChange={(e) => {
            const t = Number(e.target.value);
            setPosition(t);
            if (audioRef.current) audioRef.current.currentTime = t;
          }}
        />
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
