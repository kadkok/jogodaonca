# Jogo da Onça 3D — WebGPU | Multiplayer | Bot (v2)

**Como publicar no GitHub Pages**

1. Envie `index.html`, `game.js` e `README.md` para a raiz do repositório.
2. Vá em **Settings → Pages** e selecione **Branch: main** e **Folder: /(root)**. Salve.
3. Acesse: `https://SEU-USUARIO.github.io/NOME-DO-REPO/`

## Mudar o modo pela URL
- Local (2 jogadores): `?mode=local`
- Bot: `?mode=bot&side=J|C&level=easy|medium|hard`
- Multiplayer (mock de teste em duas abas): `?mode=mp` (para produção, ligue um backend realtime).

## Recursos
- Render WebGPU (fallback WebGL), PBR “metal” com IBL, câmera 360°.
- Regras completas com **capturas em cadeia** para a Onça.
- **Bot 3 níveis** (difícil com minimax+poda em profundidade 5).
- Sons simples, animações suaves, HUD com turno/fps.
