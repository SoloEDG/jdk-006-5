import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, X, AudioLines, CheckCircle2 } from "lucide-react";
import type { StudioDraft } from "../../../shared/types";
import { resolveMediaUrl } from "../model/useStudio";
import { formatTime } from "../../../shared/time";

/** 草稿预览：在不发布的情况下，按最终玩家的方式试听与浏览字幕 */
export function StudioPreview({
  draft,
  title,
  onClose,
}: {
  draft: StudioDraft;
  title: string;
  onClose: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(draft.media?.duration ?? 0);
  const [collected, setCollected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    if (draft.media)
      resolveMediaUrl(draft.media.assetId)
        .then((u) => alive && setUrl(u))
        .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [draft.media]);

  const cues = useMemo(
    () => [...draft.cues].sort((a, b) => a.start - b.start),
    [draft.cues],
  );
  const current = cues.find((c) => position >= c.start && position < c.end);

  return (
    <div className="modal-backdrop">
      <section className="studio-preview" role="dialog" aria-modal="true">
        <header className="dialog-header">
          <div>
            <span className="eyebrow">DRAFT PREVIEW</span>
            <h2>预览 · {title || "未命名场景"}</h2>
            <p>预览不会写入调查进度，也不会影响任何正在进行的收听。</p>
          </div>
          <button className="icon-button" aria-label="关闭预览" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <audio
          ref={audioRef}
          src={url ?? undefined}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        <div className="preview-stage">
          <div className="preview-wave">
            {(draft.media?.wave ?? []).map((v, i) => (
              <i
                key={i}
                className={
                  i / (draft.media?.wave.length || 1) <=
                  position / (duration || 1)
                    ? "played"
                    : ""
                }
                style={{ height: `${Math.max(6, Math.min(60, v * 48))}px` }}
              />
            ))}
            <span
              className="playhead"
              style={{ left: `${(position / (duration || 1)) * 100}%` }}
            />
          </div>
          <div className="preview-controls">
            <button
              aria-label={playing ? "暂停" : "播放"}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;
                if (audio.paused) void audio.play();
                else audio.pause();
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <span>
              {formatTime(position)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="preview-caption">
          <span>{current?.speaker ?? "雾港电台"}</span>
          <p>{current?.text ?? "（这里会显示当前字幕）"}</p>
        </div>

        <div className="preview-cues">
          {cues.map((cue, i) => {
            const live = cue.id === current?.id;
            const clue = cue.sound
              ? draft.clues.find((c) => c.id === cue.sound!.clueId)
              : null;
            const got = cue.sound ? collected.has(cue.sound.clueId) : false;
            return (
              <article key={cue.id} className={`preview-cue ${live ? "live" : ""} ${cue.stale ? "stale" : ""}`}>
                <button
                  className="cue-time"
                  onClick={() => {
                    if (audioRef.current)
                      audioRef.current.currentTime = cue.start;
                  }}
                >
                  {formatTime(cue.start)}
                </button>
                <div>
                  <strong>
                    {i + 1}. {cue.speaker || "（未设置说话人）"}
                  </strong>
                  <p>{cue.text || "（未填写字幕）"}</p>
                  {cue.sound && (
                    <button
                      className={`sound-clue ${got ? "collected" : ""}`}
                      disabled={!clue || cue.stale}
                      onClick={() =>
                        setCollected((prev) => {
                          const next = new Set(prev);
                          next.add(cue.sound!.clueId);
                          return next;
                        })
                      }
                    >
                      {got ? <CheckCircle2 size={12} /> : <AudioLines size={12} />}
                      {got
                        ? `已收集 · ${clue?.title ?? ""}`
                        : `声音窗口 ${formatTime(cue.sound.start)}–${formatTime(
                            cue.sound.end,
                          )} · ${cue.sound.description || "缺少描述"}`}
                    </button>
                  )}
                  {cue.stale && (
                    <small className="stale-text">
                      时间点已失效，需回到编辑页确认
                    </small>
                  )}
                </div>
              </article>
            );
          })}
          {cues.length === 0 && (
            <p className="empty-small">还没有字幕句，预览仅可试听录音。</p>
          )}
        </div>
      </section>
    </div>
  );
}
