"use client";

import { useParams } from "next/navigation";
import SessionEditor from "./session-editor";

export default function VisualizerSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionEditor sessionId={sessionId} />;
}
