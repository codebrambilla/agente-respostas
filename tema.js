// Tema claro / escuro da consulta. Carregado no <head> (antes de desenhar a
// pagina) para nao piscar o tema errado. Sem escolha guardada, segue o
// sistema; o botao do topo troca e guarda neste navegador.
"use strict";
(function () {
  const CHAVE = "consulta-tema";
  const raiz = document.documentElement;
  const escuroNoSistema = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  let escolhido = null;
  try { escolhido = localStorage.getItem(CHAVE); } catch (e) { /* navegador sem armazenamento */ }
  if (escolhido === "claro" || escolhido === "escuro") raiz.dataset.tema = escolhido;

  const atual = () => raiz.dataset.tema || (escuroNoSistema() ? "escuro" : "claro");

  function marcar(botao) {
    const escuro = atual() === "escuro";
    botao.querySelector(".tema-texto").textContent = escuro ? "Modo claro" : "Modo escuro";
    botao.querySelector(".icone-sol").hidden = !escuro;
    botao.querySelector(".icone-lua").hidden = escuro;
    botao.setAttribute("aria-pressed", escuro ? "true" : "false");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const botao = document.getElementById("tema");
    if (!botao) return;
    marcar(botao);
    botao.addEventListener("click", () => {
      const novo = atual() === "escuro" ? "claro" : "escuro";
      raiz.dataset.tema = novo;
      try { localStorage.setItem(CHAVE, novo); } catch (e) { /* so nesta visita */ }
      marcar(botao);
    });
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => marcar(botao));
    }
  });
})();
