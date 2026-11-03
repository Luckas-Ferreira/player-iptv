# StreamTV – Player IPTV para Smart TV

Player IPTV web completo, leve e otimizado para rodar no navegador de Smart TVs antigas, especialmente Panasonic com navegador embutido.

---

## 🚀 Como Usar

### 1. Abrir Localmente (PC ou Mac)

Com Node.js instalado, inicie o servidor local do projeto:

```
node server.js
```

Abra `http://127.0.0.1:8080` e deixe o campo **Servidor** vazio para usar o
provedor padrão. O servidor local encaminha somente a API desse provedor,
sem enviar as credenciais para proxies públicos.

O Live Server local na porta 5500 redireciona automaticamente para
`http://127.0.0.1:8080`. Mantenha `node server.js` rodando.

Abrir `index.html`, usar Live Server, `python -m http.server` ou `npx serve`
não resolve CORS quando o provedor bloqueia chamadas do navegador.
Servidores personalizados e vídeos continuam com acesso direto.

### 2. Na Smart TV

No PowerShell, para permitir acesso da TV na mesma rede:

```powershell
$env:HOST = '0.0.0.0'
node server.js
```

- Mantenha o computador ligado e acesse `http://IP_DO_COMPUTADOR:8080` na TV.
- Libere a porta 8080 somente na rede privada; não exponha o servidor à internet.
- O acesso ao provedor continua em HTTP, necessário para TVs antigas; use uma rede confiável.

---

## 📺 Funcionalidades

| Feature | Status |
|---------|--------|
| Login Xtream Codes | ✅ |
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

O foco tem contraste alto e volta ao mesmo item ao sair dos detalhes.
Use **Anterior** e **Próxima** no topo do catálogo para trocar de página.
A categoria selecionada permanece marcada enquanto você navega pelos títulos.

### Leveza para TVs com pouca memória

- Até 12 cards por página, com carregamento de capas conforme entram na tela.
- No máximo duas imagens sendo baixadas ao mesmo tempo; a troca de página cancela as pendentes.
- Somente a última lista de canais, filmes ou séries fica no cache da API.
- Sem animações, sombras de foco, zoom ou imagens decorativas em tela cheia.
- Layout adaptado a HD, Full HD e celular, sem fontes externas ou novas dependências.

---

## 🔗 Tipos de Conexão

### Xtream Codes
Preencha:
- **Servidor**: deixe vazio para usar o padrão, ou informe `http://meuservidor.com:8080`
- **Usuário**: `seu_usuario`
- **Senha**: `sua_senha`

---

## 📁 Estrutura do Projeto

```
player-iptv/
├── index.html          # HTML principal (todas as telas)
├── styles.css          # Design system + tema TV
├── app.js              # Orquestrador principal
├── server.js           # Servidor local + acesso à API sem CORS
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

O servidor local usa apenas módulos nativos do Node.js. Para executar as verificações:

```bash
node --test
```

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

- Fundo escuro, destaque vermelho e foco claro de alto contraste.
- Início com TV ao Vivo, Filmes e Séries em botões grandes.
- Favoritos e Continuar Assistindo em uma segunda linha.
- Categorias e paginação fixas durante a rolagem do catálogo.
- Tipografia grande e instruções de navegação sempre visíveis fora do player.
- Bordas e cores sólidas para indicar o foco, sem efeitos animados.
