# Mesa — VTT leve para jogar com os amigos

Mesa virtual no estilo Roll20 / Owlbear Rodeo, feita para rodar bem no celular e no PC ao mesmo tempo que o Discord.
É só HTML + JavaScript (sem build, sem framework). A sincronização usa o **Firebase Realtime Database** no plano gratuito.

## O que tem

- **Mapa e tokens**: envio de mapas e imagens (comprimidas automaticamente em WebP), tokens redondos/quadrados/livres, tamanhos, cores, nome, arrastar com encaixe no grid, desfazer (Ctrl+Z).
- **Tamanho dos tokens**: botões Miúdo / Médio / Grande / Enorme / Imenso no painel do token, ou arraste a alça laranja no canto do token selecionado (Alt = tamanho livre). O canto superior esquerdo fica no lugar e o token reencaixa no grid, ocupando 2×2, 3×3, 4×4 casas…
- **Grid** quadrado ou hexagonal, alinhado ao mapa: arraste sobre um quadrado (ou de centro a centro de hexágonos) do próprio mapa e o grid se ajusta sozinho, com ajuste fino por botões. Também dá para informar quantos quadrados de largura o mapa tem, ou mexer em tamanho, deslocamento, cor e opacidade.
- **Camadas**: Mapa (fundo), Tokens e Mestre (tokens escondidos dos jogadores).
- **Medir**: régua compartilhada (todos veem) com regra de diagonal D&D 5e, 1-2-1 ou distância real, e distância mostrada ao arrastar um token. A régua aceita **pontos intermediários** para medir caminhos com curvas: toque ponto a ponto (toque de novo no último ponto para terminar), ou durante o arraste aperte **Espaço** no PC / pare o dedo um instante no celular a cada curva. Mostra a distância acumulada em cada ponto e o total.
- **Áreas de efeito** para magias e ataques: círculo (raio), cone (largura = comprimento, como no D&D 5e), quadrado/cubo e linha (1 ou 2 casas de largura). Tamanho encaixa em casas inteiras, as casas atingidas ficam pintadas e todos veem. Dá para fixar a área no mapa (apaga com a borracha).
- **Ping** (tocar ou segurar no mapa) e ping que puxa a câmera de todos (mestre).
- **Névoa de guerra**: revelar/esconder com retângulo, polígono ou pincel; revelar tudo / cobrir tudo; modo **Editar** para mover, redimensionar, inverter ou apagar uma forma depois. O mestre vê a névoa transparente.
- **Visão dinâmica**: ferramenta **Paredes** (paredes e portas), luz nos tokens (raio em casas + penumbra). Só aparece o que alguma luz alcança, bloqueado pelas paredes; portas abrem/fecham com um clique do mestre; áreas já exploradas ficam à meia-luz. Tochas e lampiões = tokens na camada Mapa com luz.
- **Tokens como no Owlbear**: Ctrl+C / Ctrl+X / Ctrl+V (inclusive entre cenas e mesas), Ctrl+D duplica com numeração automática (Goblin 2, Goblin 3…), caixa de seleção arrastando no vazio, Ctrl+A, girar (alça ou R), espelhar, trazer para frente/mandar para trás ([ ]), travar no lugar (L), esconder (H), Ctrl+Z / Ctrl+Y.
- **Ponteiro laser**: arraste com a ferramenta Ping — todos veem o rastro.
- **Texto e notas no mapa**: escreva direto no mapa ou cole notas adesivas (o mestre pode deixar uma nota só para ele).
- **Desenho**: livre, linha, retângulo, círculo, borracha, cores e espessuras; modo **Selecionar** para mover, redimensionar, recolorir ou apagar depois.
- **Biblioteca na conta**: tudo que você envia fica na sua conta e pode ser usado em qualquer mesa sua.
- **Dados e chat**: `/r 2d6+3`, vantagem/desvantagem, `4d6kh3`, explosivos, sucessos (`8d10>=7`), Fudge, rolagens embutidas `[[1d20]]`, rolagem oculta pro mestre (`/gr`), sussurros (`/w Nome`), `/me`. Rolagens aparecem em destaque no mapa se o chat estiver fechado.
- **Fichas**: genérica, D&D 5e ou parada de d6; atributos e ações roláveis com referências (`1d20+@FOR.mod+@Prof`), PV, notas, dono e visibilidade. Token vinculado à ficha usa o PV dela na barra de vida.
- **Iniciativa**: adicionar tokens, rolar, ordenar, rodadas, passar a vez (aparece no topo para todos).
- **Barra de vida abaixo do token** (com os números quando há zoom), **CA** num escudo e **ND/CR** numa etiqueta no próprio token, e condições (envenenado, caído, atordoado…). PV aceita "−5 / +3" direto no campo. Dá para esconder vida/CA/ND dos jogadores por token (útil para monstros).
- **Cenas**: várias cenas por mesa; o mestre prepara uma cena escondido e depois "Mostra" para os jogadores.

### Leveza

O mapa só é redesenhado quando algo muda (parado = zero CPU), a aba em segundo plano não desenha nada, o arraste de tokens é limitado na rede e as imagens são baixadas uma vez e ficam em cache no aparelho. A biblioteca de imagens só baixa as miniaturas quando você abre a aba.

## 1. Testar agora (modo local)

Sem configurar nada, o VTT roda em **modo local**: as abas do mesmo navegador conversam entre si. Serve para conhecer a ferramenta.

Os módulos JavaScript não funcionam abrindo o `index.html` direto (file://). No Windows, dê dois cliques em **`iniciar.bat`** (precisa do Python instalado) — ele sobe o servidor e abre o navegador. Ou rode na pasta:

```bash
python -m http.server 8000
```

e abra `http://localhost:8000`. Crie uma mesa numa aba e cole o link em outra aba para entrar como jogador.
(No VS Code, a extensão *Live Server* também serve.)

## 2. Configurar o Firebase (para jogar online)

1. Acesse <https://console.firebase.google.com>, clique em **Criar projeto** (pode desativar o Google Analytics).
2. No projeto, vá em **Build → Authentication → Começar → Método de login** e ative:
   - **Google** (escolha um e-mail de suporte e salve);
   - **E-mail/senha**;
   - **Anônimo** (opcional — só se quiser permitir "Entrar como convidado").
3. Vá em **Build → Realtime Database → Criar banco de dados**. Escolha a região (ex.: `us-central1`) e comece em **modo bloqueado**.
4. Na aba **Regras** do Realtime Database, apague tudo, cole o conteúdo de `database.rules.json` e clique em **Publicar**.
5. Em **Configurações do projeto (engrenagem) → Seus apps → Web (`</>`)**, registre um app (não precisa de Hosting). Copie o objeto `firebaseConfig`.
6. Abra `js/config.js` e troque `export const firebaseConfig = null;` pelo seu objeto. Confira se ele tem o campo `databaseURL` — se não tiver, copie a URL que aparece no topo da página do Realtime Database.

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "seu-projeto.firebaseapp.com",
  databaseURL: "https://seu-projeto-default-rtdb.firebaseio.com",
  projectId: "seu-projeto",
  appId: "1:...:web:...",
};
```

Essas chaves podem ficar públicas no GitHub: no Firebase quem protege os dados são as **regras** do passo 4, não a chave.

## 3. Publicar (GitHub Pages)

1. Suba a pasta para um repositório no GitHub (ex.: `EnricoDiGioia/VTT`).
2. No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em alguns minutos o site fica em `https://enricodigioia.github.io/VTT/`.
4. No Firebase, **Authentication → Configurações → Domínios autorizados**, adicione `enricodigioia.github.io` (sem isso o login com Google não funciona no site publicado). `localhost` já vem autorizado.

Alternativa: com o Firebase CLI (`npm i -g firebase-tools`), `firebase login`, `firebase init` (escolha o projeto; o `firebase.json` já está pronto) e `firebase deploy` publica o site e as regras de uma vez.

## Como jogar

- **Contas**: cada pessoa entra com Google ou e-mail e senha. Quem **cria a mesa** é o mestre dela para sempre (em qualquer aparelho); quem entra pelo código ou link é jogador. A tela inicial mostra **Minhas mesas** com o seu papel em cada uma.
- Em **Sala** você copia o link de convite. O mestre pode promover outra pessoa a mestre também (Sala → Tornar mestre); o criador nunca perde o papel.
- **Convidado** (opcional): entra sem conta, só como jogador, e perde o acesso ao trocar de aparelho.
- **Modo local (teste)**: a conta é só um nome — o mesmo nome é sempre a mesma pessoa. Para simular um jogador, abra outra aba, toque em **Sair** e entre com outro nome.
- No celular: um dedo arrasta o mapa ou um token, dois dedos dão zoom, segurar o dedo no mapa faz ping, tocar duas vezes num token abre o token/ficha. O botão **Painel** abre chat, iniciativa, fichas etc.
- No PC: roda do mouse dá zoom, arrastar o fundo (ou botão direito / espaço + arrastar) move a câmera, duplo clique abre o token.
- Atalhos: `V` mover, `M` medir, `D` desenho, `F` névoa, `W` paredes, `P` ping/laser · `Ctrl+C/X/V` copiar/recortar/colar, `Ctrl+D` duplicar, `Ctrl+A` selecionar tudo, `Ctrl+Z` desfazer, `Ctrl+Y` refazer · `R` gira 45° (Shift+R volta), `[` `]` ordem, `L` trava, `H` esconde (mestre), `Del` apaga, setas movem · `Alt` desliga o encaixe, `Esc` cancela.
- No PC, arrastar no vazio faz caixa de seleção; para mover o mapa use botão direito, rodinha do mouse pressionada ou Espaço+arrastar (dá para trocar em Mover → "Arrastar no vazio"). No celular, um dedo move o mapa.
- Mapa com grid desenhado: depois de enviar, toque em **Alinhar agora** (ou Cenas → ⚙ → **Alinhar no mapa**), dê zoom e arraste de um canto a outro de um quadrado do mapa — se arrastar sobre um bloco de 3×3 ou 5×5 e informar o número de casas, fica ainda mais preciso. Confira as linhas laranja, use as setas para o ajuste fino e toque em **Aplicar**.
- Para colocar imagens: aba **Biblioteca**, arrastar um arquivo para o mapa, ou colar com `Ctrl+V`. Imagens grandes viram mapa (o mestre confirma).
- Digite `/ajuda` no chat para ver os comandos de dados.

## Limites do plano gratuito do Firebase (Spark)

1 GB armazenado, 10 GB de download por mês e 100 conexões simultâneas — sobra para um grupo de amigos. Um mapa comprimido costuma ter 200 KB–1,5 MB e cada pessoa baixa cada imagem uma vez só (fica em cache). Apague mapas antigos da Biblioteca se o espaço apertar.

## Limitações conhecidas

- Para testar no celular pela rede de casa (`http://192.168.x.x:8000`), use login por e-mail e senha — o login com Google só funciona em domínios autorizados.
- Tokens escondidos, névoa, sussurros e rolagens ocultas são escondidos na tela, mas os dados chegam ao navegador de todos os membros da sala; alguém que abra as ferramentas de desenvolvedor consegue ver. Para uma mesa entre amigos isso costuma bastar.
- Ainda não tem iluminação dinâmica/visão por token, áudio, nem importação de fichas de sistemas específicos.

## Estrutura

```
index.html            página única (lobby + mesa)
css/style.css         visual (responsivo: lateral no PC, gaveta no celular)
js/config.js          configuração do Firebase
js/state.js           estado da sala, ações e caminhos no banco
js/board.js           canvas: desenho sob demanda, câmera, toque/mouse, ferramentas
js/grid.js            grid quadrado/hex, encaixe e distâncias
js/dice.js            rolador de dados
js/assets.js          compressão, envio e cache de imagens
js/net/firebase.js    backend Firebase
js/net/local.js       backend local (abas do mesmo navegador)
js/ui/*.js            painéis: chat, iniciativa, fichas, biblioteca, cenas, sala, HUD do token
database.rules.json   regras de segurança do Realtime Database
```
