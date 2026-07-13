"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api-fetch";

/**
 * 把 markdown 回复转成适合朗读的纯文本：
 * 去掉代码块、表格、链接语法、标记符号，保留正文
 */
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "。代码内容已省略。")
    .replace(/^\|.*\|$/gm, "") // 表格行
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 链接保留文字
    .replace(/[#*_`>~]/g, "")
    .replace(/^[-+]\s+/gm, "")
    .replace(/\n{2,}/g, "。")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * TTS 播放：POST /api/ai/tts 拿 mp3 → Audio 播放
 * 同一时间只播一条；再点同一条则停止。
 */
export function useTts() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestSeqRef.current++;
    cleanup();
    setPlayingId(null);
    setLoadingId(null);
  }, [cleanup]);

  const play = useCallback(
    async (id: string, text: string) => {
      // 再点同一条 → 停止
      if (playingId === id || loadingId === id) {
        stop();
        return;
      }
      stop();
      const seq = ++requestSeqRef.current;
      setLoadingId(id);
      try {
        const speech = markdownToSpeech(text);
        if (!speech) {
          setLoadingId(null);
          return;
        }
        const res = await apiFetch("/api/ai/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: speech }),
        });
        if (!res.ok) throw new Error("语音合成失败");
        const blob = await res.blob();
        if (seq !== requestSeqRef.current) return; // 期间用户点了别的

        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          cleanup();
          setPlayingId(null);
        };
        audio.onerror = () => {
          cleanup();
          setPlayingId(null);
        };
        await audio.play();
        setLoadingId(null);
        setPlayingId(id);
      } catch {
        if (seq === requestSeqRef.current) {
          cleanup();
          setLoadingId(null);
          setPlayingId(null);
        }
      }
    },
    [playingId, loadingId, stop, cleanup],
  );

  useEffect(() => stop, [stop]);

  return { playingId, loadingId, play, stop };
}
