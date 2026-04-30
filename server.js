const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const { URL } = require("url");

const app = express();

app.set("trust proxy", true);

const PORT = process.env.PORT || 3001;

const DEFAULT_STREAM_URL =
  process.env.DEFAULT_STREAM_URL ||
  "http://p2mult.xyz/live/27654857/79845566/12666.m3u8";

app.use(cors({ origin: "*" }));
app.use(express.static(path.join(__dirname, "public")));

function isProbablyPlaylist(targetUrl, contentType) {
  return (
    targetUrl.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("audio/mpegurl")
  );
}

function proxifyUrl(rawUrl, baseUrl, req) {
  const absolute = new URL(rawUrl, baseUrl).href;

  const host = req.get("host");
  const protocol = host.includes("railway.app") ? "https" : req.protocol;

  return `${protocol}://${host}/proxy?url=${encodeURIComponent(absolute)}`;
}

function rewritePlaylist(body, baseUrl, req) {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;

      if (!trimmed.startsWith("#")) {
        return proxifyUrl(trimmed, baseUrl, req);
      }

      return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        return `URI="${proxifyUrl(uri, baseUrl, req)}"`;
      });
    })
    .join("\n");
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/stream", (req, res) => {
  const target = req.query.url || DEFAULT_STREAM_URL;
  res.redirect(`/proxy?url=${encodeURIComponent(target)}`);
});

app.get("/proxy", async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).send("Missing url parameter");
  }

  let parsed;

  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).send("Invalid url parameter");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).send("Only http/https URLs are allowed");
  }

  try {
    const upstream = await axios.get(target, {
      responseType: "arraybuffer",
      maxRedirects: 8,
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        Referer: `${parsed.protocol}//${parsed.host}/`,
        Origin: `${parsed.protocol}//${parsed.host}`,
      },
    });

    const finalUrl = upstream.request?.res?.responseUrl || target;
    const contentType = upstream.headers["content-type"] || "";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Cache-Control", "no-store");

    if (isProbablyPlaylist(target, contentType)) {
      const playlist = upstream.data.toString("utf8");
      const rewritten = rewritePlaylist(playlist, finalUrl, req);

      res.setHeader(
        "Content-Type",
        "application/vnd.apple.mpegurl; charset=utf-8"
      );

      return res.send(rewritten);
    }

    res.setHeader("Content-Type", contentType || "application/octet-stream");
    return res.send(upstream.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const msg = error.response?.statusText || error.message;

    return res.status(status).send(`Proxy error: ${msg}`);
  }
});

app.listen(PORT, () => {
  console.log(`HLS proxy rodando na porta ${PORT}`);
});
