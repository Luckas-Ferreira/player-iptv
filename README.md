# StreamTV – Player IPTV para Smart TV

Player IPTV web completo, leve e otimizado para rodar no navegador de Smart TVs antigas, especialmente Panasonic com navegador embutido.

---

## 🚀 Como Usar

### 1. Abrir Localmente (PC ou Mac)

Basta abrir o arquivo `index.html` em qualquer navegador:

```
player-iptv/index.html
```

Ou usar um servidor local simples (recomendado para evitar bloqueios de CORS):

```bash
# Com Python 3
cd player-iptv
python3 -m http.server 8080
# Acesse: http://localhost:8080

# Com Node.js (npx)
npx serve .
```

### 2. Na Smart TV

- Coloque os arquivos em um pen drive ou servidor HTTP local
- Acesse via navegador da TV: `http://SEU_IP:8080`
- Ou carregue o `index.html` diretamente do pen drive (se o navegador permitir)

---

## 📺 Funcionalidades

| Feature | Status |
|---------|--------|
| Login Xtream Codes | ✅ |
| Login M3U | ✅ |
| Modo Demonstração | ✅ |
| TV ao Vivo | ✅ |
| Filmes (VOD) | ✅ |
| Séries com Episódios | ✅ |
| Favoritos | ✅ |
| Recentes | ✅ |
| Busca | ✅ |
| Navegação por Controle Remoto | ✅ |
| Suporte HLS | ✅ (via hls.js / CDN) |
| Capas/Posters | ✅ (lazy load) |
| Tema Escuro Premium | ✅ |
| Configurações | ✅ |

---

## 🎮 Navegação por Controle Remoto

| Tecla | Ação |
|-------|------|
| ↑ ↓ ← → | Mover foco entre itens |
| OK / Enter | Abrir item selecionado |
| Voltar / Backspace | Retornar à tela anterior |
| Play/Pause | Pausar/reproduzir (na tela do player) |

---

## 🔗 Tipos de Conexão

### Xtream Codes
Preencha:
- **Servidor**: `http://meuservidor.com:8080`
- **Usuário**: `seu_usuario`
- **Senha**: `sua_senha`

### Lista M3U
Cole a URL completa da playlist:
- `http://meuservidor.com/lista.m3u`
- `http://meuservidor.com/get.php?username=X&password=Y&type=m3u`

---

## 📁 Estrutura do Projeto

```
player-iptv/
├── index.html          # HTML principal (todas as telas)
├── styles.css          # Design system + tema TV
├── app.js              # Orquestrador principal
├── modules/
│   ├── storage.js      # localStorage (favoritos, recentes, config)
│   ├── auth.js         # Autenticação Xtream + M3U
│   ├── api.js          # API IPTV + M3U parser + dados demo
│   ├── renderer.js     # Renderização de cards e componentes
│   ├── search.js       # Busca local com debounce
│   ├── player.js       # Player HLS + vídeo nativo
│   └── navigation.js   # Controle remoto + foco
└── README.md
```

---

## ⚙️ Dependências

**Nenhuma dependência local.** O projeto é 100% HTML/CSS/JavaScript puro.

O único recurso externo (carregado sob demanda, apenas quando necessário):
- `hls.js 1.4.12` (light build, ~100KB) – para streams HLS em navegadores sem suporte nativo

---

## 🖥️ Compatibilidade

- Navegadores modernos (Chrome, Firefox, Edge, Safari)
- Navegadores de Smart TV (Samsung, LG, Panasonic, Sony)
- Testado com: Chrome 60+, Firefox 60+
- Suporte a vídeo: HLS (via hls.js), TS direto, MP4, MKV

---

## 🎨 Design

- Fundo escuro elegante `#0d0d1a`
- Destaque roxo/azul `#7c3aed` / `#2563eb`
- Cards com canto arredondado e sombra
- Focus ring super visível para navegação com setas
- Tipografia grande e legível para TV
- Animações mínimas (apenas transform/opacity)
