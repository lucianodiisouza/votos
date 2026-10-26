# Apuração 2026

Resultado final do 2º turno das Eleições 2026 com os dados oficiais do TSE: **https://votos.oprimo.dev**

Durante a apuração o site atualizava ao vivo. Depois da totalização ele virou um arquivo estático, sem backend.

- Placar final, mapa do Brasil por UF (quem venceu, swing vs 1º turno) e tabela de todas as UFs
- Curva da apuração com as viradas marcadas, a partir das 237 leituras gravadas durante a noite
- Pesquisas da véspera × urnas e resultado por região
- Governadores no 2º turno e explorador de qualquer cargo/UF (combobox pesquisável)

## Como funciona

O site é estático (um `index.html`, sem build) e roda na Vercel.

- `data/tse/` tem o resultado final do 2º turno (presidente por UF e os 6 governadores) e as fotos, no
  mesmo caminho do CDN do TSE. Gerado por `scripts/snapshot-tse.py`.
- `data/history.json` é a série da curva, gravada pelo serviço que rodou no Coolify durante a apuração.
- `static.js` traz a malha das UFs (IBGE) já projetada em SVG e o resultado final do 1º turno por UF,
  gerado por `scripts/build-static.py`.

O explorador ainda busca os arquivos do 1º turno direto em `resultados.tse.jus.br`.

O backend de histórico e web push (`api/`) foi desligado depois da eleição; o código está no histórico do git.

## Deploy

```sh
./deploy.sh
```
