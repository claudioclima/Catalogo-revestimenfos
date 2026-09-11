# Como publicar o Catálogo de Revestimentos

Este pacote é um site completo, pronto para publicar. Ninguém precisa saber programar
para seguir os passos abaixo — mas se puder pedir ajuda de alguém com um pouco mais de
familiaridade com tecnologia para essa configuração inicial (leva uns 15-20 minutos),
melhor ainda.

## Parte 1 — Criar o banco de dados gratuito (Firebase)

O app precisa de um lugar para guardar produtos, lojas, vendedores e pedidos de forma
que todos os vendedores vejam as mesmas informações. Vamos usar o Firebase, do Google,
que tem plano gratuito suficiente para o seu caso.

1. Acesse **https://console.firebase.google.com** e entre com uma conta Google.
2. Clique em **"Criar projeto"**, dê um nome (ex: `catalogo-revestimentos`) e siga o
   assistente (pode desativar o Google Analytics, não é necessário).
3. Dentro do projeto, no menu lateral, vá em **"Compilação" > "Firestore Database"**.
4. Clique em **"Criar banco de dados"**, escolha uma região (ex: `southamerica-east1`
   para o Brasil) e selecione **"Iniciar em modo de teste"**. Confirme.
5. Volte para a página inicial do projeto (ícone de casa) e clique no ícone **`</>`**
   ("Web") para registrar um app.
6. Dê um apelido ao app (ex: `catalogo-web`) e clique em registrar. O Firebase vai
   mostrar um bloco de código com um objeto chamado `firebaseConfig` parecido com isto:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "catalogo-revestimentos.firebaseapp.com",
     projectId: "catalogo-revestimentos",
     storageBucket: "catalogo-revestimentos.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

7. Copie esses valores e cole no arquivo **`src/firebaseConfig.js`** deste pacote,
   substituindo os textos "COLE_AQUI".

> Importante: o "modo de teste" do Firestore deixa o banco aberto por 30 dias por
> padrão. Antes desse prazo, volte em Firestore Database > Regras e ajuste as regras
> de acesso (ou peça ajuda a um desenvolvedor para configurar regras de segurança
> adequadas ao seu caso).

## Parte 2 — Testar localmente (opcional, mas recomendado)

Se quiser conferir que tudo funciona antes de publicar:

1. Instale o **Node.js** (https://nodejs.org, versão LTS) se ainda não tiver.
2. Abra um terminal dentro da pasta deste projeto e rode:
   ```
   npm install
   npm run dev
   ```
3. Abra o endereço que aparecer (algo como `http://localhost:5173`) no navegador.

## Parte 3 — Publicar de verdade (Vercel)

1. Crie uma conta gratuita em **https://vercel.com** (dá pra entrar com GitHub, Google
   ou e-mail).
2. Suba este projeto para o **GitHub**:
   - Crie uma conta em https://github.com se ainda não tiver.
   - Crie um repositório novo (ex: `catalogo-revestimentos`).
   - Suba os arquivos deste pacote para esse repositório (pelo site do GitHub dá para
     arrastar e soltar os arquivos direto, sem usar linha de comando).
3. Na Vercel, clique em **"Add New" > "Project"**, escolha **"Import Git Repository"**
   e selecione o repositório que você acabou de criar.
4. A Vercel detecta automaticamente que é um projeto Vite. Clique em **"Deploy"**.
5. Em 1-2 minutos, a Vercel te dá um link, algo como
   `https://catalogo-revestimentos.vercel.app` — esse é o link que você compartilha
   com os consultores.

Pronto: qualquer pessoa que abrir esse link no celular ou computador vai usar o mesmo
catálogo, carrinho e comissionamento — os dados ficam salvos no Firebase e
compartilhados entre todos.

## Se algo der errado

Volte para a conversa com a Claude e explique o que apareceu na tela (mensagem de
erro, ou o passo em que travou) — com o link de um site publicado de verdade, fica bem
mais fácil de diagnosticar problemas do que dentro da pré-visualização do chat.
