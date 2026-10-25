# votos-api

Backend mínimo para a página de apuração do 2º turno (TSE, eleição 6258). Faz polling do JSON do TSE a cada 20s (ETag), guarda o histórico e envia web push (VAPID).

## Endpoints (todos com CORS `*`)

| Método | Rota | Resposta |
|---|---|---|
| GET | `/history[?since=<ms>]` | `{series:[{t, idg, pst, v:{"13":pct,"22":pct}, votes:{...}}]}` (cache 10s) |
| GET | `/vapid` | `{key}` (chave pública VAPID) |
| POST | `/subscribe` | corpo = `PushSubscription` JSON → `201` (máx. 4KB) |
| POST | `/unsubscribe` | `{endpoint}` → `204` |
| GET | `/health` | `{ok, samples, subs, lastIdg, lastFetch, lastError}` |

Pushes: virada na liderança (cooldown 5 min), marcos de 10%…90% e 99% das seções, e resultado final/eleito. Tudo deduplicado e persistido.

## Deploy no Coolify

1. **New Resource → Application** apontando para este repositório/pasta, **Build Pack: Dockerfile**.
2. **Ports Exposes: `3000`**.
3. **Storages → Add Volume**: destino **`/data`** (histórico, inscritos, chaves VAPID e estado ficam aqui — sem isso tudo some a cada deploy).
4. **Domínio** sugerido: `https://votos-api.oprimo.dev`.
5. **Variáveis de ambiente** (opcionais):
   - `VAPID_PUBLIC`, `VAPID_PRIVATE` — se ausentes, são geradas uma vez e salvas em `/data/vapid.json`. Recomendado fixar via env para não invalidar as inscrições se o volume for perdido.
   - `VAPID_SUBJECT` (padrão `https://votos.oprimo.dev`)
   - `PORT` (padrão 3000), `DATA_DIR` (padrão `/data` no Docker), `POLL_MS` (padrão 20000), `SITE_URL` (padrão `https://votos.oprimo.dev/`)
6. Health check: `/health`.

Gerar chaves: `npx web-push generate-vapid-keys`.

## Testar

```sh
npm ci && PORT=3000 node server.js
curl localhost:3000/health
curl localhost:3000/history
curl localhost:3000/vapid
curl -X POST localhost:3000/subscribe -H 'content-type: application/json' \
  -d '{"endpoint":"https://fcm.googleapis.com/fcm/send/teste","keys":{"p256dh":"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM","auth":"tBHItJI5svbpez7KI4CCXg"}}'
```

Ou com Docker: `docker build -t votos-api . && docker run -p 3000:3000 -v votos-data:/data votos-api`.
