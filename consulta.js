// Consulta da Bella (pagina estatica): a mesma conversa do Teams, no navegador.
// Seguranca:
//  - o endereco da funcao e fixo; a politica da pagina tambem so deixa falar com ele;
//  - todo texto que vem da funcao entra como texto (textContent), nunca como
//    HTML: o markdown da Bella (negrito, listas, links) e montado aqui, peca a peca;
//  - link so abre se for https;
//  - o codigo de acesso fica so neste navegador (localStorage); a conversa, so
//    nesta aba (sessionStorage).
"use strict";

const API = "https://zweuntyaeelxnktllxqc.supabase.co/functions/v1/consultar";
const TEMPO_LIMITE_MS = 60000;  // a IA pode consultar varias coisas antes de responder
const $ = (id) => document.getElementById(id);
const el = (tag, props, ...filhos) => {
  const e = Object.assign(document.createElement(tag), props || {});
  e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== ""));
  return e;
};

const guardar = (onde, chave, valor) => { try { onde.setItem(chave, valor); } catch (e) { /* sem armazenamento */ } };
const ler = (onde, chave) => { try { return onde.getItem(chave) || ""; } catch (e) { return ""; } };
const novoId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

let codigo = ler(localStorage, "consulta-codigo");
// o navegador (para "as minhas") e a conversa desta aba
let navegador = ler(localStorage, "consulta-navegador");
if (!navegador) { navegador = novoId(); guardar(localStorage, "consulta-navegador", navegador); }
let sessao = ler(sessionStorage, "consulta-sessao");
if (!sessao) { sessao = novoId(); guardar(sessionStorage, "consulta-sessao", sessao); }

// historico desta aba: [{de: "pessoa"|"bella", texto, mensagem?, verMais?, ficha?}]
let historico = [];
try { historico = JSON.parse(ler(sessionStorage, "consulta-historico") || "[]"); } catch (e) { historico = []; }
const salvar = () => guardar(sessionStorage, "consulta-historico", JSON.stringify(historico.slice(-60)));

// ------------------------------------------------------------ chamadas

class ErroConsulta extends Error {}

async function chamar(params, corpo) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let r;
  try {
    r = await fetch(`${API}?${new URLSearchParams(params)}`, {
      method: corpo ? "POST" : "GET",
      headers: corpo ? { "x-codigo": codigo, "content-type": "application/json" } : { "x-codigo": codigo },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal, cache: "no-store", referrerPolicy: "no-referrer",
    });
  } catch (e) {
    throw new ErroConsulta(e.name === "AbortError" ? "a resposta demorou demais" : "sem conexão com a consulta");
  } finally {
    clearTimeout(relogio);
  }
  let d = {};
  try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
  if (r.status === 401) { sair(); throw new ErroConsulta("código de acesso inválido"); }
  if (!r.ok) throw new ErroConsulta(typeof d.erro === "string" ? d.erro : `erro ${r.status}`);
  return d;
}

// ------------------------------------------------------------ markdown da Bella -> DOM (sem innerHTML)

// **negrito**, *italico* ou _italico_, `codigo` e [texto](https://...)
function trechos(linha) {
  const partes = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(?<![\w*])[_*](?![\s_*])(.+?)(?<!\s)[_*](?![\w*])|`([^`]+)`/g;
  let fim = 0, m;
  while ((m = re.exec(linha))) {
    if (m.index > fim) partes.push(document.createTextNode(linha.slice(fim, m.index)));
    if (m[1] !== undefined) partes.push(el("strong", {}, ...trechos(m[1])));
    else if (m[2] !== undefined) partes.push(el("a", { href: m[3], textContent: m[2], target: "_blank", rel: "noopener noreferrer" }));
    else if (m[4] !== undefined) partes.push(el("em", {}, ...trechos(m[4])));
    else partes.push(el("code", { textContent: m[5] }));
    fim = re.lastIndex;
  }
  if (fim < linha.length) partes.push(document.createTextNode(linha.slice(fim)));
  return partes;
}

function markdown(md) {
  const blocos = [];
  let lista = null, par = null;
  const fechar = () => { lista = null; par = null; };
  for (const bruta of String(md || "").split("\n")) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) { fechar(); continue; }
    const item = linha.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!lista) { lista = el(/^\s*\d/.test(linha) ? "ol" : "ul"); blocos.push(lista); par = null; }
      lista.append(el("li", {}, ...trechos(item[1])));
      continue;
    }
    lista = null;
    if (!par) { par = el("p"); blocos.push(par); } else par.append(el("br"));
    par.append(...trechos(linha.replace(/^#{1,4}\s+/, "")));
  }
  return blocos;
}

// ------------------------------------------------------------ ficha de uma solicitacao (leitor do Webformat)

const CAMPOS_FICHA = ["Descrição longa", "Descrição curta", "Tipo de material", "PDM", "Grupo de mercadorias",
  "Grupo de compradores", "Classe de avaliação", "NCM", "Classe", "Nº de classe", "UAR", "Código definitivo",
  "Dados complementares", "Fabricante", "Referência", "Unidade de medida", "Bem patrimonial", "Urgente",
  "Motivo da urgência"];
const LARGOS = new Set(["Descrição longa", "Tipo de material", "PDM", "Dados complementares", "Motivo da urgência"]);

function valorRico(v) {
  return v.split(/\*\*(.+?)\*\*/).map((pedaco, i) =>
    i % 2 ? el("strong", { textContent: pedaco }) : el("span", { className: "valor-extra", textContent: pedaco }));
}

function situacaoDe(andamento) {
  const t = andamento.join(" ");
  const parada = t.match(/Está parada com (.+?) há (.+?)\./);
  if (/^Concluída/m.test(andamento.join("\n"))) return ["concluida", "Concluída"];
  if (andamento.some((l) => l.startsWith("Cancelada"))) return ["cancelada", "Cancelada"];
  if (parada) return ["andamento", `Parada há ${parada[2]}`];
  return ["andamento", "Em andamento"];
}

function montarFicha(md, numero) {
  const pars = String(md || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const cab = pars.length ? pars[0].match(/^\*\*Solicitação (\d+)\*\*(?: · (.*))?$/) : null;
  if (!cab) return el("div", {}, ...markdown(md || `Não consegui ler a solicitação ${numero} agora.`));
  const campos = [], andamento = [];
  for (const p of pars.slice(1)) {
    const m = p.match(/^([^:*]{2,30}): (.+)$/s);
    if (m && CAMPOS_FICHA.includes(m[1])) campos.push([m[1], m[2]]);
    else andamento.push(p.replace(/\*\*/g, ""));
  }
  const [classe, rotulo] = situacaoDe(andamento);
  const partes = [el("div", { className: "ficha-topo" },
    el("div", {},
      el("p", { className: "ficha-numero", textContent: `Solicitação ${cab[1]}` }),
      cab[2] ? el("h3", { className: "ficha-titulo", textContent: cab[2] }) : null),
    andamento.length ? el("span", { className: `ficha-situacao ${classe}`, textContent: rotulo }) : null)];
  if (andamento.length) {
    partes.push(el("ol", { className: "linha-tempo", ariaLabel: "Andamento" },
      ...andamento.map((l) => el("li", { className: /^(Motivo|Antes disso)/.test(l) ? "detalhe" : "", textContent: l }))));
  }
  if (campos.length) {
    partes.push(el("dl", { className: "ficha-campos" }, ...campos.map(([rot, val]) =>
      el("div", { className: "campo" + (LARGOS.has(rot) ? " largo" : "") + (rot === "Código definitivo" && /\d{5,}/.test(val) ? " codigo" : "") },
        el("dt", { textContent: rot }), el("dd", {}, ...valorRico(val))))));
  }
  return el("div", { className: "ficha" }, ...partes);
}

// ------------------------------------------------------------ mensagens na tela

const rolar = () => requestAnimationFrame(() => $("fim").scrollIntoView({ block: "end", behavior: "smooth" }));

function avatar() {
  return el("img", { className: "avatar", src: "img/favicon.png", alt: "", width: 32, height: 32 });
}

function botoesAvaliar(m) {
  if (!m.mensagem) return null;
  const caixa = el("div", { className: "avaliar" });
  if (m.avaliada) {
    caixa.append(el("span", { className: "obrigada", textContent: "Obrigada pelo retorno! 💙" }));
    return caixa;
  }
  const votar = async (reacao) => {
    for (const b of caixa.querySelectorAll("button")) b.disabled = true;
    try {
      await chamar({ avaliacao: 1 }, { sessao, mensagem: m.mensagem, reacao });
      m.avaliada = reacao;
      salvar();
      caixa.replaceChildren(el("span", { className: "obrigada", textContent: "Obrigada pelo retorno! 💙" }));
    } catch (e) {
      for (const b of caixa.querySelectorAll("button")) b.disabled = false;
    }
  };
  caixa.append(
    el("button", { type: "button", className: "voto", title: "Ajudou", ariaLabel: "Ajudou", textContent: "👍", onclick: () => votar("like") }),
    el("button", { type: "button", className: "voto", title: "Não ajudou", ariaLabel: "Não ajudou", textContent: "👎", onclick: () => votar("dislike") }));
  return caixa;
}

function desenhar(m) {
  if (m.de === "pessoa") {
    return el("div", { className: "msg da-pessoa" }, el("div", { className: "balao" }, ...markdown(m.texto)));
  }
  const corpo = m.ficha ? [montarFicha(m.texto, m.ficha)] : markdown(m.texto);
  const extras = [];
  if (m.verMais) {
    extras.push(el("div", { className: "sugestoes" },
      el("button", { type: "button", className: "sugestao", textContent: "Ver mais", onclick: () => enviar("ver mais") })));
  }
  return el("div", { className: "msg da-bella" + (m.erro ? " erro" : "") }, avatar(),
    el("div", { className: "coluna" }, el("div", { className: "balao" }, ...corpo), ...extras, botoesAvaliar(m)));
}

function adicionar(m) {
  historico.push(m);
  salvar();
  const n = desenhar(m);
  $("conversa").append(n);
  rolar();
  return n;
}

function digitando(texto) {
  const n = el("div", { className: "msg da-bella digitando" }, avatar(),
    el("div", { className: "balao" }, el("span", { className: "pontinhos", ariaHidden: "true" }, el("i"), el("i"), el("i")),
      el("span", { className: "digitando-texto", textContent: texto || "Bella está digitando…" })));
  $("conversa").append(n);
  rolar();
  return n;
}

const EXEMPLOS = [
  "quantas estão com a CH há mais de 48 h úteis?", "urgentes com pendência técnica", "o que a CH quer na 4779?",
  "já existe válvula gaveta DN 100?", "o que é o 1300031697?", "situação da 3951", "como estão as minhas?",
  "taxa de reprovação por tipo", "o que é NLAG?",
];

function boasVindas() {
  return el("div", { className: "msg da-bella" }, avatar(),
    el("div", { className: "coluna" },
      el("div", { className: "balao" },
        el("p", {}, "Oi! Eu sou a ", el("strong", { textContent: "Bella" }), " 😊 Pode conversar comigo do seu jeito, como falaria com alguém do time."),
        el("p", { textContent: "Eu consulto as solicitações do Webformat, o catálogo de materiais do SAP e a base de conhecimento do time. Só consulto: não aprovo nem altero nada." })),
      el("div", { className: "sugestoes" }, ...EXEMPLOS.map((q) =>
        el("button", { type: "button", className: "sugestao", textContent: q, onclick: () => enviar(q) })))));
}

function redesenhar() {
  $("conversa").replaceChildren(boasVindas(), ...historico.map(desenhar));
  rolar();
}

// ------------------------------------------------------------ conversa

let ocupado = false;
let espera = 0;

// "situação da 3951": o leitor do Webformat responde em segundos (ou minutos, se precisar acordar)
async function acompanhar(d, aviso) {
  const minha = ++espera;
  const texto = aviso.querySelector(".digitando-texto");
  texto.textContent = d.leitor_vivo ? `Lendo a solicitação ${d.numero} no Webformat…`
    : d.nuvem ? `Buscando a solicitação ${d.numero} no Webformat. Pode levar uns 2 minutos…`
    : `O leitor do Webformat está desligado. A pergunta ficou na fila: deixe a página aberta que a resposta aparece aqui.`;
  let fim = Date.now() + (d.leitor_vivo ? 3 : d.nuvem ? 8 : 30) * 60 * 1000;
  let acordou = !!d.nuvem;
  while (Date.now() < fim && minha === espera) {
    await new Promise((ok) => setTimeout(ok, 1500));
    let p;
    try { p = await chamar({ pedido: d.pedido }); } catch (e) { continue; }
    if (p.nuvem && !acordou) {
      acordou = true;
      fim = Math.max(fim, Date.now() + 8 * 60 * 1000);
      texto.textContent = `Está demorando mais que o normal. Buscando a solicitação ${d.numero} de outro jeito, mais uns 2 minutos…`;
    }
    if (p.status === "respondido" || p.status === "erro") {
      aviso.remove();
      adicionar({ de: "bella", texto: p.resposta || "", ficha: d.numero });
      return;
    }
  }
  aviso.remove();
  if (minha === espera) adicionar({ de: "bella", texto: "O Webformat não respondeu a tempo 😕 Tente de novo em alguns minutos.", erro: true });
}

async function enviar(texto) {
  texto = String(texto || "").trim();
  if (!texto || ocupado || !codigo) return;
  ocupado = true;
  $("enviar").disabled = true;
  adicionar({ de: "pessoa", texto });
  const aviso = digitando();
  try {
    const d = await chamar({ conversa: 1 }, { sessao, navegador, texto });
    if (d.pedido) {
      await acompanhar(d, aviso);
    } else {
      aviso.remove();
      adicionar({ de: "bella", texto: d.resposta || "", mensagem: d.mensagem || null, verMais: !!d.ver_mais });
    }
  } catch (e) {
    aviso.remove();
    adicionar({ de: "bella", erro: true,
      texto: `Não consegui responder agora (${e instanceof ErroConsulta ? e.message : "erro inesperado"}). Tente de novo em instantes.` });
  } finally {
    ocupado = false;
    $("enviar").disabled = false;
    $("mensagem").focus();
  }
}

function novaConversa() {
  espera++;
  historico = [];
  salvar();
  sessao = novoId();
  guardar(sessionStorage, "consulta-sessao", sessao);
  redesenhar();
  $("mensagem").focus();
}

// ------------------------------------------------------------ telas e eventos

function telas() {
  document.body.classList.toggle("logado", !!codigo);
  $("form-codigo").hidden = !!codigo;
  $("chat").hidden = !codigo;
  $("sair").hidden = !codigo;
  if (codigo) { redesenhar(); $("mensagem").focus(); } else $("codigo").focus();
}

function sair() {
  codigo = "";
  try { localStorage.removeItem("consulta-codigo"); } catch (e) { /* ok */ }
  espera++;
  telas();
}

$("form-codigo").addEventListener("submit", (ev) => {
  ev.preventDefault();
  codigo = $("codigo").value.trim();
  $("codigo").value = "";
  if (!codigo) return;
  guardar(localStorage, "consulta-codigo", codigo);
  telas();
});

$("form-chat").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const t = $("mensagem").value;
  if (!t.trim() || ocupado) return;
  $("mensagem").value = "";
  ajustarAltura();
  enviar(t);
});

// Enter envia; Shift+Enter quebra a linha
$("mensagem").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    $("form-chat").requestSubmit();
  }
});
function ajustarAltura() {
  const t = $("mensagem");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
}
$("mensagem").addEventListener("input", ajustarAltura);

$("nova").addEventListener("click", novaConversa);
$("sair").addEventListener("click", sair);
telas();
