# Apuração 2026 ao vivo

Apuração em tempo real do 2º turno das Eleições 2026 com os dados oficiais do TSE: **https://votos.oprimo.dev**

- Placar fixo, projeção do resultado final, votos que faltam e quanto cada um precisa pra virar
- Mapa do Brasil por UF (quem lidera, swing vs 1º turno, % apurado)
- Curva de evolução da apuração com as viradas marcadas
- Pesquisas da véspera × urnas, por região e tabela de todas as UFs
- Governadores no 2º turno e explorador de qualquer cargo/UF (combobox pesquisável)
- PWA com alertas de virada e marcos da apuração (web push + som no navegador)

## Como funciona

O site é estático (um `index.html`, sem build) e roda na Vercel. Cada navegador busca os JSONs
direto do CDN do TSE (`resultados.tse.jus.br`, CORS liberado) a cada 15s, revalidando por ETag:
quando nada mudou o TSE responde 304. Os estados só são baixados quando o resumo indica mudança, e
arquivos mais antigos vindos do CDN são ignorados pra os números nunca andarem pra trás.

`static.js` traz a malha das UFs (IBGE) já projetada em SVG e o resultado final do 1º turno por UF,
gerado por `scripts/build-static.py`.

`api/` é um serviço Node pequeno (rodando no Coolify) que grava o histórico da apuração pra curva e
dispara os web pushes. Veja `api/README.md`.

## Deploy

```sh
./deploy.sh
```

Carimba um build id em `index.html`, `sw.js` e `version.json`. Quem está com a página aberta
recarrega sozinho no próximo ciclo.

Projeções são estimativas, não resultado oficial.
