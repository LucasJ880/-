"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { apiFetch } from "@/lib/api-fetch";

export type VoiceInputState = "idle" | "recording" | "transcribing";

const MAX_RECORDING_MS = 90_000; // 超长自动停止，防止忘记关麦
const MIN_BLOB_BYTES = 2_000; // 过短视为误触，不发转写

const subscribeToBrowserSupport = () => () => {};

const getBrowserSupport = () =>
  typeof MediaRecorder !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * 语音输入：MediaRecorder 录音 → /api/ai/transcribe（Whisper）→ 文字回调
 * 点击开始 / 再次点击结束；中英混说自动识别。
 */
export function useVoiceInput(
  onTranscript: (text: string) => void,
  onError?: (message: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>("idle");
  const supported = useSyncExternalStore(
    subscribeToBrowserSupport,
    getBrowserSupport,
    () => false,
  );
  const stateRef = useRef<VoiceInputState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStateBoth = (s: VoiceInputState) => {
    stateRef.current = s;
    setState(s);
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!supported) {
      onError?.("当前浏览器不支持录音");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // iOS Safari 不支持 webm，回退 mp4
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size < MIN_BLOB_BYTES) {
          setStateBoth("idle");
          return;
        }
        setStateBoth("transcribing");
        try {
          const form = new FormData();
          const ext = (recorder.mimeType || "").includes("mp4") ? "mp4" : "webm";
          form.append("file", blob, `voice.${ext}`);
          const res = await apiFetch("/api/ai/transcribe", {
            method: "POST",
            body: form,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "语音识别失败");
          if (data.text) {
            onTranscript(String(data.text));
          } else {
            onError?.("没有听清，请再说一次");
          }
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "语音识别失败");
        } finally {
          setStateBoth("idle");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setStateBoth("recording");
      timeoutRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      }, MAX_RECORDING_MS);
    } catch {
      releaseStream();
      onError?.("无法访问麦克风，请检查浏览器权限");
    }
  }, [onTranscript, onError, supported]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const toggle = useCallback(() => {
    if (stateRef.current === "recording") stop();
    else if (stateRef.current === "idle") start();
  }, [start, stop]);

  // 卸载时释放麦克风
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") {
        try {
          recorderRef.current.stop();
        } catch {}
      }
      releaseStream();
    };
  }, []);

  return { state, supported, start, stop, toggle };
}
