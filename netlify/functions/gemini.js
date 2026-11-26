async function callModel(model, apiKey, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function resolveLatestFlashModel(apiKey, failedModel) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  if (!res.ok || !Array.isArray(data.models)) {
    throw new Error(data.error?.message || "Nem sikerült lekérni az elérhető Gemini modelleket.");
  }

  const candidates = data.models
    .filter(
      (m) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        /gemini-.*flash/i.test(m.name) &&
        !/audio|tts|image|live|embedding|robotics|computer/i.test(m.name)
    )
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((name) => name !== failedModel);

  const preferred = candidates.filter((n) => !/lite|exp/i.test(n));
  const pool = preferred.length ? preferred : candidates;
  pool.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  if (!pool.length) {
    throw new Error("Nem található aktív Flash modell ehhez az API-kulcshoz.");
  }
  return pool[0];
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Csak POST kérés engedélyezett." }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Hiányzik a GEMINI_API_KEY a Netlify beállításokból." }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { prompt, files = [], jsonMode = true } = body;

    if (!prompt && files.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Üres kérés." }) };
    }

    const parts = [];
    if (prompt) {
      parts.push({ text: prompt });
    }

    for (const file of files) {
      if (file.data && file.mimeType) {
        parts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: file.data,
          },
        });
      }
    }

    const payload = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    let model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    let response = await callModel(model, apiKey, payload);
    let data = await response.json();

    if (response.status === 404) {
      model = await resolveLatestFlashModel(apiKey, model);
      response = await callModel(model, apiKey, payload);
      data = await response.json();
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || "Gemini API hiba.", model }),
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text, model }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Szerverhiba." }),
    };
  }
};
