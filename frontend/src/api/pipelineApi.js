import { API_BASE } from "./apiBase";

export async function runPipelines(pipelineNames, dbName = null) {
  const response = await fetch(`${API_BASE}/api/pipeline/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipelines: Array.isArray(pipelineNames) ? pipelineNames : [pipelineNames],
      db_name: dbName || undefined,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Pipeline start failed");
  }

  const payload = await response.json();
  return {
    ok: true,
    message: payload.message,
    pipelines: payload.pipelines || [],
  };
}

export async function getPipelineStatus(pipelineNames) {
  const query = Array.isArray(pipelineNames)
    ? `pipelines=${pipelineNames.join(",")}`
    : `pipelines=${pipelineNames}`;

  const response = await fetch(`${API_BASE}/api/pipeline/status?${query}`);

  if (!response.ok) {
    throw new Error("Failed to get pipeline status");
  }

  const payload = await response.json();
  return payload.pipelines || {};
}
