import { Check, Headphones, MapPin } from "lucide-react";
import type {
  CaseContent,
  Investigation,
  SceneId,
} from "../../../shared/types";
export function Chapters({
  content,
  story,
  onEnter,
}: {
  content: CaseContent;
  story: Investigation;
  onEnter: (id: SceneId) => void;
}) {
  let customIndex = 0;
  return (
    <div className="chapters">
      <div className="side-caption">
        案件章节 <span>CASE 001</span>
      </div>
      {content.scenes.map((s) => {
        const isCustom = !s.chapter;
        if (isCustom) customIndex += 1;
        const chapterLabel = isCustom
          ? `自${String(customIndex).padStart(2, "0")}`
          : s.chapter;
        return (
          <button
            key={s.id}
            className={`chapter ${story.sceneId === s.id ? "active" : ""}`}
            disabled={!story.visited.includes(s.id)}
            onClick={() => onEnter(s.id)}
          >
            <span className="chapter-number">
              {story.visited.includes(s.id) && story.sceneId !== s.id ? (
                <Check size={13} />
              ) : (
                chapterLabel
              )}
            </span>
            <span>
              <strong>{s.title}</strong>
              <small>
                <MapPin size={9} />
                {s.location}
              </small>
            </span>
            {story.sceneId === s.id && <Headphones size={13} />}
          </button>
        );
      })}
      <div className="chapter-footer">
        {content.scenes.length} 段录音，一桩尘封的往事。
        <br />
        每一段声音都可能是答案。
      </div>
    </div>
  );
}
