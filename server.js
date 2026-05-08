const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { URL } = require("url");

const app = express();

app.set("trust proxy", true);

const PORT = process.env.PORT || 8080;

const DEFAULT_STREAM_URL =
  process.env.DEFAULT_STREAM_URL ||
  "http://p2mult.xyz/live/27654857/79845566/12666.m3u8";

app.use(cors({ origin: "*" }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  const start = Date.now();

  console.log(
    `[${new Date().toISOString()}] Novo player iniciado no proxy | ${req.method} ${req.originalUrl} | IP: ${req.ip}`
  );

  res.on("finish", () => {
    const ms = Date.now() - start;

    console.log(
      `[${new Date().toISOString()}] Requisição finalizada | ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | ${ms}ms`
    );
  });

  next();
});

function isProbablyPlaylist(targetUrl, contentType = "") {
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

  const protocol =
    req.headers["x-forwarded-proto"] ||
    req.protocol ||
    "https";

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

app.get("/", (_req, res) => {
  res.send("HLS proxy online");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "online",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/stream", (req, res) => {
  const target = req.query.url || DEFAULT_STREAM_URL;

  console.log(
    `[${new Date().toISOString()}] Stream iniciado | URL: ${target}`
  );

  res.redirect(`/proxy?url=${encodeURIComponent(target)}`);
});

app.get("/proxy", async (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);

  const target = req.query.url;

  if (!target) {
    console.log("URL ausente");

    return res.status(400).send("Missing url parameter");
  }

  let parsed;

  try {
    parsed = new URL(target);
  } catch {
    console.log("URL inválida");

    return res.status(400).send("Invalid url parameter");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    console.log("Protocolo inválido");

    return res.status(400).send("Only http/https URLs are allowed");
  }

  try {
    console.log(
      `[${new Date().toISOString()}] Proxyando conteúdo | ${target}`
    );

    const upstream = await axios.get(target, {
      responseType: "arraybuffer",
      maxRedirects: 8,
      timeout: 30000,
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

    console.log(
      `[${new Date().toISOString()}] Conteúdo recebido | Type: ${contentType}`
    );

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "no-store");

    if (isProbablyPlaylist(target, contentType)) {
      console.log(
        `[${new Date().toISOString()}] Playlist HLS detectada`
      );

      const playlist = upstream.data.toString("utf8");

      const rewritten = rewritePlaylist(
        playlist,
        finalUrl,
        req
      );

      res.setHeader(
        "Content-Type",
        "application/vnd.apple.mpegurl; charset=utf-8"
      );

      return res.status(200).send(rewritten);
    }

    console.log(
      `[${new Date().toISOString()}] Arquivo enviado ao player`
    );

    res.setHeader(
      "Content-Type",
      contentType || "application/octet-stream"
    );

    return res.status(200).send(Buffer.from(upstream.data));
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Proxy error:`,
      error.message
    );

    const status = error.response?.status || 502;

    const msg =
      error.response?.statusText || error.message;

    return res.status(status).send(`Proxy error: ${msg}`);
  }
});

const server = http.createServer(app);

server.timeout = 0;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[${new Date().toISOString()}] Proxy rodando na porta: ${PORT}`
  );
});
