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

    // Képek (JPEG/PNG/WebP) és PDF számlák csatolása
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || "Gemini API hiba." }),
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Szerverhiba." }),
    };
  }
};