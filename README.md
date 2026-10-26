# agente-respostas

Formulário de resposta às perguntas do agente de aprovação (abre pelo botão "Outra resposta / escrever" do cartão no Teams).

Página estática, sem nenhum segredo: os dados vêm da função `responder` do Supabase, e só com o id + token que estão no link do cartão.
O código-fonte fica no repositório privado `agente-aprovacao-webformat` (`web/responder.html`); este repositório é só a cópia publicada.

`consulta.html`: consulta da Bella (Meetup pela conta Microsoft, Sabesp pela chave de acesso pessoal; os dados vêm da função `consultar`). A tela anterior ficou em `consulta-antiga.html`; `consulta-nova.html` só leva para a `consulta.html`.
