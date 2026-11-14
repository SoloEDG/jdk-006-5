import type { MediaAssetMeta } from "../../../shared/types";
import { newId } from "../../../shared/time";

export const WAVE_BARS = 100;

/** 把 PCM 数据压成固定条数的波形柱（取值 0.1 ~ 1，和内建波形口径一致） */
export function computeWave(
  channel: Float32Array,
  bars = WAVE_BARS,
): number[] {
  const block = Math.max(1, Math.floor(channel.length / bars));
  const wave: number[] = [];
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * block;
    for (let j = 0; j < block && start + j < channel.length; j++)
      sum += Math.abs(channel[start + j]);
    const avg = sum / block;
    wave.push(Math.max(0.1, Math.min(1, avg * 2.2)));
  }
  return wave;
}

function decodeWithWebAudio(
  blob: Blob,
): Promise<{ duration: number; wave: number[] }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";
    const cleanup = () => {
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
    audio.onloadedmetadata = async () => {
      const duration = audio.duration;
      try {
        const Ctx =
          window.OfflineAudioContext ??
          (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext;
        if (!Ctx) throw new Error("no-offline-context");
        const arrayBuffer = await blob.arrayBuffer();
        // 离线上下文无需 close，也不会占用音频设备
        const probe = new Ctx(1, 1, 8000);
        const buffer = await probe.decodeAudioData(arrayBuffer.slice(0));
        const channel = buffer.getChannelData(0);
        cleanup();
        resolve({
          duration: Number.isFinite(duration) ? duration : buffer.duration,
          wave: computeWave(channel),
        });
      } catch {
        // 浏览器无法解码时退回静音波形，仍允许上传（HTMLAudio 也许能播）
        cleanup();
        resolve({
          duration: Number.isFinite(duration) ? duration : 0,
          wave: Array.from({ length: WAVE_BARS }, () => 0.1),
        });
      }
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("无法读取这段录音，请换一个音频文件"));
    };
    audio.src = url;
  });
}

/** 上传本地录音文件 → 可存入 IndexedDB 的记录 */
export async function ingestAudioFile(
  file: File,
): Promise<{ record: { meta: MediaAssetMeta; blob: Blob } }> {
  if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|ogg|webm|aac)$/i.test(file.name))
    throw new Error("请选择音频文件（wav / mp3 / m4a / ogg 等）");
  const blob = file.slice(0, file.size, file.type || "audio/mpeg");
  const { duration, wave } = await decodeWithWebAudio(blob);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("录音时长读取失败，请换一个文件");
  const meta: MediaAssetMeta = {
    id: newId(),
    name: file.name,
    mime: file.type || "audio/mpeg",
    size: file.size,
    duration,
    wave,
    createdAt: Date.now(),
  };
  return { record: { meta, blob } };
}
