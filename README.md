# HLS Proxy Pronto

Proxy HLS simples para testar playlists `.m3u8` em uma página web.

Use somente com streams que você tem autorização para acessar/retransmitir.

## Rodar local

```bash
npm install
npm start
```

Abra:

```txt
http://localhost:3001
```

Ou use direto:

```txt
http://localhost:3001/stream
```

## Trocar URL padrão

No deploy, defina a variável:

```bash
DEFAULT_STREAM_URL=https://exemplo.com/playlist.m3u8
```

## Deploy no Render

- Build command: `npm install`
- Start command: `npm start`
- Environment variable opcional: `DEFAULT_STREAM_URL`

## Endpoints

```txt
GET /              página de teste
GET /health        status
GET /stream        redireciona para o stream padrão proxificado
GET /proxy?url=... proxy de playlist e segmentos
```
