// Consulta da Bella, tela nova (consulta.html desde 26/10/2026; antes consulta-nova.html): a mesma logica da consulta.js, com
// menu lateral, conversa no meio, sugestoes coloridas e a Bella mostrando o que consulta.
// Seguranca (igual a consulta.js):
//  - o endereco da funcao e fixo; a politica da pagina tambem so deixa falar com ele;
//  - todo texto que vem da funcao entra como texto (textContent), nunca como
//    HTML: o markdown da Bella (negrito, listas, links) e montado aqui, peca a peca;
//  - link so abre se for https;
//  - a entrada (Meetup: conta Microsoft; Sabesp: chave de acesso criada no banco) fica so
//    neste navegador (localStorage); a conversa, nesta aba (sessionStorage) e, com chave pessoal
//    ou conta Microsoft, no historico (banco de dados, so da pessoa, 30 dias: ?historico=1);
//  - a resposta aparece enquanto a Bella escreve (stream); numeros de solicitacao
//    e codigos do SAP viram botao; listas podem ser baixadas em planilha (CSV).
"use strict";

const API = "https://zweuntyaeelxnktllxqc.supabase.co/functions/v1/consultar";
const TEMPO_LIMITE_MS = 90000;  // a IA pode consultar varias coisas antes de responder
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

// codigo de acesso ou sessao do login Microsoft ("S" + 64 hex): os dois vao no x-codigo
let codigo = ler(localStorage, "consulta-codigo");
let nome = ler(localStorage, "consulta-nome");          // dono do codigo pessoal ("" = codigo do time)
// so avisa do codigo do time depois que o servidor confirma (?quem): sem piscar na entrada
let codigoDoTime = ler(localStorage, "consulta-time") === "1";
// logo depois do login Microsoft o nome ainda nao chegou: a Bella "digita" ate o ?quem responder
let esperandoNome = false;
const ehSessao = (c) => /^S[0-9a-f]{64}$/.test(c);
// formas de entrar que a pagina mostra (o servidor diz; ?microsoft=1 mostra o botao para testar)
let formas = { microsoft: /[?&]microsoft=1/.test(location.search), codigo: true };
let aba = "sabesp";      // aba aberta na entrada: "sabesp" (chave) ou "meetup" (conta Microsoft)
// o navegador (para "as minhas") e a conversa desta aba
let navegador = ler(localStorage, "consulta-navegador");
if (!navegador) { navegador = novoId(); guardar(localStorage, "consulta-navegador", navegador); }
let sessao = ler(sessionStorage, "consulta-sessao");
if (!sessao) { sessao = novoId(); guardar(sessionStorage, "consulta-sessao", sessao); }

// historico desta aba: [{de: "pessoa"|"bella", texto, mensagem?, verMais?, ficha?}]
let historico = [];
try { historico = JSON.parse(ler(sessionStorage, "consulta-historico") || "[]"); } catch (e) { historico = []; }
// so nesta aba (abrir uma conversa ou comecar outra nao conta como mensagem nova)
const salvarNaAba = () => guardar(sessionStorage, "consulta-historico", JSON.stringify(historico.slice(-60)));
// mensagem nova (ou avaliada): na aba e no historico
const salvar = () => { salvarNaAba(); agendarNuvem(sessao, historico); };
// atalhos: Ctrl no Windows, Cmd no Mac
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const CTRL = MAC ? "⌘" : "Ctrl";

// ------------------------------------------------------------ chamadas

class ErroConsulta extends Error {}

// O relogio vale ate o fim do corpo (no stream, a resposta inteira); depois, abortar nao faz nada.
// `parar`: o botao "Parar" da pagina (AbortSignal) tambem corta a chamada.
async function pedir(params, corpo, parar) {
  const controle = new AbortController();
  setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  if (parar) parar.addEventListener("abort", () => controle.abort(), { once: true });
  let r;
  try {
    r = await fetch(`${API}?${new URLSearchParams(params)}`, {
      method: corpo ? "POST" : "GET",
      headers: corpo ? { "x-codigo": codigo, "content-type": "application/json" } : { "x-codigo": codigo },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal, cache: "no-store", referrerPolicy: "no-referrer",
    });
  } catch (e) {
    if (parar?.aborted) throw new ErroConsulta("interrompida");
    throw new ErroConsulta(e.name === "AbortError" ? "a resposta demorou demais" : "sem conexão com a consulta");
  }
  if (r.status === 401) {
    let d = {};
    try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
    const motivo = typeof d.erro === "string" ? d.erro : "código de acesso inválido";
    const estava = !!codigo;
    sair();
    // quem estava dentro e foi barrado vê o motivo na tela de entrada
    if (estava) avisarCodigo(tipoDoBarrado(motivo));
    throw new ErroConsulta(motivo);
  }
  if (!r.ok) {
    let d = {};
    try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
    throw new ErroConsulta(typeof d.erro === "string" ? d.erro : `erro ${r.status}`);
  }
  return r;
}

async function chamar(params, corpo) {
  const r = await pedir(params, corpo);
  try { return await r.json(); } catch (e) { return {}; }
}

// Conversa em stream: texto aos pedacos (aoEvento) e, no fim, a resposta completa.
// Sem IA ou com "situacao da 3951" a funcao responde JSON, como antes.
async function conversarAoVivo(corpo, aoEvento, parar) {
  const r = await pedir({ conversa: 1, stream: 1 }, corpo, parar);
  if (!(r.headers.get("content-type") || "").includes("event-stream")) {
    try { return await r.json(); } catch (e) { return {}; }
  }
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let resto = "", fim = null;
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      resto += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = resto.indexOf("\n\n")) >= 0) {
        let evento = "message", dados = "";
        for (const l of resto.slice(0, i).split("\n")) {
          if (l.startsWith("event:")) evento = l.slice(6).trim();
          else if (l.startsWith("data:")) dados += l.slice(5).trim();
        }
        resto = resto.slice(i + 2);
        if (!dados) continue;
        const d = JSON.parse(dados);
        if (evento === "fim") fim = d;
        else if (evento === "erro") throw new ErroConsulta(typeof d.erro === "string" ? d.erro : "erro na resposta");
        else aoEvento(evento, d);
      }
    }
  } catch (e) {
    if (e instanceof ErroConsulta) throw e;
    if (parar?.aborted) throw new ErroConsulta("interrompida");
    throw new ErroConsulta(e.name === "AbortError" ? "a resposta demorou demais" : "a conexão caiu no meio da resposta");
  }
  if (!fim) throw new ErroConsulta("a resposta veio incompleta");
  return fim;
}

// ------------------------------------------------------------ markdown da Bella -> DOM (sem innerHTML)

// Numero de solicitacao e codigo do SAP viram botao: o clique pergunta a Bella.
// O codigo ainda tem "copiar" (para colar no SAP ou no Webformat).
function botaoSolicitacao(n) {
  return el("button", { type: "button", className: "ref", textContent: n, title: `Ver a situação da ${n}`,
    onclick: () => enviar(`situação da ${n}`) });
}

// icones em SVG montado peca a peca (a politica da pagina nao deixa carregar nada de fora)
const ICONES = {
  copiar: "M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM4 7h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h11V9z",
  ok: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  enviar: "M3 20.5v-6.2l9-2.3-9-2.3V3.5l19 8.5z",
  parar: "M6 6h12v12H6z",
  refazer: "M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z",
  editar: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z",
};
function icone(nome) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICONES[nome]);
  s.append(p);
  return s;
}

// copia e mostra o "copiado" no proprio botao por 1,5 s
function botaoCopiar(texto, rotulo, classe, comTexto) {
  const desenhar = (nomeIcone, t) => b.replaceChildren(icone(nomeIcone), ...(comTexto ? [el("span", { textContent: t })] : []));
  const b = el("button", { type: "button", className: classe, title: rotulo, ariaLabel: rotulo });
  desenhar("copiar", "Copiar");
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(typeof texto === "function" ? texto() : texto);
      desenhar("ok", "Copiado");
      b.classList.add("copiado");
    } catch (e) {
      b.title = "Não consegui copiar";
    }
    setTimeout(() => { desenhar("copiar", "Copiar"); b.classList.remove("copiado"); b.title = rotulo; }, 1500);
  };
  return b;
}

function botaoCodigo(c) {
  const copiar = botaoCopiar(c, `Copiar o código ${c}`, "copiar");
  return el("span", { className: "ref-codigo" },
    el("button", { type: "button", className: "ref", textContent: c, title: `O que é o ${c}?`, onclick: () => enviar(`o que é o ${c}?`) }),
    copiar);
}

// "solicitação 4779", "solicitações 4779, 4780 e 4781" e códigos do SAP (10 dígitos, 1 ou 2 na frente)
function comReferencias(t, ligar) {
  if (!ligar) return [document.createTextNode(t)];
  const re = /(solicita(?:ç|c)(?:ão|ao|ões|oes)\s+(?:n[º°.]?\s*)?)(\d{3,6}(?:(?:,\s*|\s+e\s+)\d{3,6})*)|\b([12]\d{9})\b/gi;
  const partes = [];
  let fim = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > fim) partes.push(document.createTextNode(t.slice(fim, m.index)));
    if (m[3]) partes.push(botaoCodigo(m[3]));
    else {
      partes.push(document.createTextNode(m[1]));
      for (const p of m[2].split(/(\d+)/)) if (p) partes.push(/^\d+$/.test(p) ? botaoSolicitacao(p) : document.createTextNode(p));
    }
    fim = re.lastIndex;
  }
  if (fim < t.length) partes.push(document.createTextNode(t.slice(fim)));
  return partes;
}

// **4779** no começo de um item ("**4779** · VALVULA...") ou logo depois de "solicitação"
const numeroDeSolicitacao = (m, linha, inicioDeItem) => /^\d{3,6}$/.test(m[1]) && (
  (inicioDeItem && m.index === 0 && /^(\s*[·—–:(,-]|\s*$)/.test(linha.slice(m.index + m[0].length))) ||
  /solicita\S*\s+(?:n[º°.]?\s*)?$/i.test(linha.slice(0, m.index)));

// **negrito**, *italico* ou _italico_, `codigo` e [texto](https://...)
function trechos(linha, ligar, inicioDeItem) {
  const partes = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(?<![\w*])[_*](?![\s_*])(.+?)(?<!\s)[_*](?![\w*])|`([^`]+)`/g;
  let fim = 0, m;
  while ((m = re.exec(linha))) {
    if (m.index > fim) partes.push(...comReferencias(linha.slice(fim, m.index), ligar));
    if (m[1] !== undefined) {
      partes.push(ligar && numeroDeSolicitacao(m, linha, inicioDeItem)
        ? el("strong", {}, botaoSolicitacao(m[1])) : el("strong", {}, ...trechos(m[1], ligar)));
    } else if (m[2] !== undefined) partes.push(el("a", { href: m[3], textContent: m[2], target: "_blank", rel: "noopener noreferrer" }));
    else if (m[4] !== undefined) partes.push(el("em", {}, ...trechos(m[4], ligar)));
    else partes.push(el("code", {}, ...comReferencias(m[5], ligar)));
    fim = re.lastIndex;
  }
  if (fim < linha.length) partes.push(...comReferencias(linha.slice(fim), ligar));
  return partes;
}

// Situacao da solicitacao vira etiqueta colorida nos itens de lista ("6090, NLAG, encerrada: ...")
const SITUACOES = /\b(encerrad[ao]s?|finalizad[ao]s?|conclu[ií]d[ao]s?|reprovad[ao]s?|cancelad[ao]s?|pend[eê]ncia(?: t[eé]cnica| fabricante| do solicitante)?|em andamento|em an[aá]lise|com a CH|enviada)\b/gi;
function corDaSituacao(t) {
  if (/^(encerr|finaliz|conclu)/i.test(t)) return "verde";
  if (/^(reprov|cancel)/i.test(t)) return "cinza";
  if (/^pend/i.test(t)) return "amarelo";
  return "azul";
}
function selosDeSituacao(li) {
  const nos = [];
  const andar = document.createTreeWalker(li, NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => n.parentElement.closest("button, a, code") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  while (andar.nextNode()) nos.push(andar.currentNode);
  for (const n of nos) {
    const t = n.nodeValue;
    SITUACOES.lastIndex = 0;
    if (!SITUACOES.test(t)) continue;
    SITUACOES.lastIndex = 0;
    const partes = [];
    let fim = 0, m;
    while ((m = SITUACOES.exec(t))) {
      if (m.index > fim) partes.push(document.createTextNode(t.slice(fim, m.index)));
      partes.push(el("span", { className: `etiqueta ${corDaSituacao(m[1])}`, textContent: m[1] }));
      fim = SITUACOES.lastIndex;
    }
    if (fim < t.length) partes.push(document.createTextNode(t.slice(fim)));
    n.replaceWith(...partes);
  }
}

function markdown(md, ligar = false) {
  const blocos = [];
  let lista = null, par = null;
  const fechar = () => { lista = null; par = null; };
  for (const bruta of String(md || "").split("\n")) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) { fechar(); continue; }
    const item = linha.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!lista) { lista = el(/^\s*\d/.test(linha) ? "ol" : "ul"); blocos.push(lista); par = null; }
      const li = el("li", {}, ...trechos(item[1], ligar, true));
      if (ligar) selosDeSituacao(li);
      lista.append(li);
      continue;
    }
    lista = null;
    if (!par) { par = el("p"); blocos.push(par); } else par.append(el("br"));
    par.append(...trechos(linha.replace(/^#{1,4}\s+/, ""), ligar));
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
  if (!cab) return el("div", {}, ...markdown(md || `Não consegui ler a solicitação ${numero} agora.`, true));
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
        el("dt", { textContent: rot }),
        el("dd", {}, ...(rot === "Código definitivo" ? comReferencias(val.replace(/\*\*/g, ""), true) : valorRico(val)))))));
  }
  return el("div", { className: "ficha" }, ...partes);
}

// ------------------------------------------------------------ mensagens na tela

// A conversa rola dentro da propria caixa (a tela fica parada). Enquanto a Bella
// escreve, so acompanha se a pessoa estiver no fim (se subiu para ler, fica onde esta).
const rolar = (sempre = true) => requestAnimationFrame(() => {
  const c = $("conversa");
  if (sempre || c.scrollHeight - c.scrollTop - c.clientHeight < 140) c.scrollTo({ top: c.scrollHeight, behavior: sempre ? "smooth" : "auto" });
});

function avatar() {
  return el("span", { className: "av" }, el("img", { src: "img/bella.png", alt: "", width: 38, height: 41 }));
}

const horaDe = (ms) => ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "";

// texto puro da resposta (para colar no Teams ou no e-mail)
const textoPuro = (md) => String(md || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https:[^)\s]+)\)/g, "$1 ($2)")
  .replace(/(^|[\s(])[_*](?![\s_*])(.+?)(?<!\s)[_*](?=[\s).,!?]|$)/gm, "$1$2").replace(/`([^`]+)`/g, "$1");

// "Refazer" (so na ultima resposta): a mesma pergunta de novo, sem a resposta antiga na memoria da Bella
function botaoRefazer(rotulo) {
  return el("button", { type: "button", className: "acao so-ultima", title: "Gerar a resposta de novo", ariaLabel: rotulo,
    onclick: refazer }, icone("refazer"), el("span", { textContent: rotulo }));
}

// Linha discreta embaixo da resposta: hora, copiar, refazer e 👍👎 (aparece ao passar o mouse; fixa na ultima)
function botoesAvaliar(m) {
  if (m.erro) return el("div", { className: "avaliar" }, botaoRefazer("Tentar de novo"));
  const caixa = el("div", { className: "avaliar" },
    m.em ? el("span", { className: "hora", textContent: horaDe(m.em) }) : null,
    botaoCopiar(() => textoPuro(m.texto), "Copiar a resposta", "acao", true), botaoRefazer("Refazer"));
  if (!m.mensagem) return caixa;
  if (m.avaliada) {
    caixa.append(el("span", { className: "obrigada", textContent: "Obrigada pelo retorno! 💙" }));
    return caixa;
  }
  const votar = async (reacao) => {
    const votos = [...caixa.querySelectorAll(".voto")];
    for (const b of votos) b.disabled = true;
    try {
      await chamar({ avaliacao: 1 }, { sessao, mensagem: m.mensagem, reacao });
      m.avaliada = reacao;
      salvar();
      for (const b of votos) b.remove();
      caixa.append(el("span", { className: "obrigada", textContent: "Obrigada pelo retorno! 💙" }));
      if (reacao === "dislike") {
        const painel = painelMotivo(m);
        caixa.after(painel);
        painel.querySelector("button").focus();
      }
    } catch (e) {
      for (const b of votos) b.disabled = false;
    }
  };
  caixa.append(
    el("button", { type: "button", className: "voto", title: "Ajudou", ariaLabel: "Ajudou", textContent: "👍", onclick: () => votar("like") }),
    el("button", { type: "button", className: "voto", title: "Não ajudou", ariaLabel: "Não ajudou", textContent: "👎", onclick: () => votar("dislike") }));
  return caixa;
}

// 👎: logo depois do voto, "o que não ajudou?" (opcional). Vai para a mesma avaliacao (a funcao completa a linha).
const MOTIVOS = ["Código ou material errado", "Não achou o que existe", "Informação desatualizada", "Resposta confusa",
  "Faltou informação"];

function painelMotivo(m) {
  const conversaDoVoto = sessao;   // a pessoa pode trocar de conversa antes de enviar
  const escolhidos = new Set();
  const chips = MOTIVOS.map((t) => {
    const b = el("button", { type: "button", className: "chip-motivo", textContent: t });
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      if (escolhidos.has(t)) escolhidos.delete(t); else escolhidos.add(t);
      b.setAttribute("aria-pressed", String(escolhidos.has(t)));
    };
    return b;
  });
  const campo = el("textarea", { className: "campo-motivo", rows: 2, maxLength: 500,
    placeholder: "Conte mais, se quiser (ex.: o código certo era…)", ariaLabel: "O que não ajudou, com as suas palavras" });
  const enviarB = el("button", { type: "button", className: "botao-motivo", textContent: "Enviar" });
  const pular = el("button", { type: "button", className: "link", textContent: "Agora não" });
  const painel = el("div", { className: "motivo", role: "group", ariaLabel: "O que não ajudou?" },
    el("p", { textContent: "Poxa 😕 O que não ajudou? (opcional)" }),
    el("div", { className: "chips-motivo" }, ...chips), campo, el("div", { className: "acoes-motivo" }, pular, enviarB));
  pular.onclick = () => painel.remove();
  enviarB.onclick = async () => {
    const comentario = [...escolhidos, campo.value.trim()].filter(Boolean).join(" · ");
    if (!comentario) { painel.remove(); return; }
    enviarB.disabled = true;
    enviarB.textContent = "Enviando…";
    try {
      await chamar({ avaliacao: 1 }, { sessao: conversaDoVoto, mensagem: m.mensagem, reacao: "dislike", comentario });
      painel.replaceWith(el("p", { className: "obrigada-motivo", textContent: "Anotado! Isso ajuda a melhorar a Bella 💙" }));
    } catch (e) {
      enviarB.disabled = false;
      enviarB.textContent = "Tentar de novo";
    }
  };
  return painel;
}

// "Baixar planilha": a lista completa do que a Bella consultou, em CSV (abre no Excel)
function botaoPlanilha(x) {
  const qtd = Number(x.total) || 0;
  const rotulo = `📥 Baixar planilha (${qtd > 5000 ? "5.000 de " : ""}${qtd.toLocaleString("pt-BR")} ${x.tipo === "sap" ? "códigos" : "solicitações"})`;
  const b = el("button", { type: "button", className: "sugestao planilha", textContent: rotulo, title: "Abre no Excel" });
  b.onclick = async () => {
    b.disabled = true;
    b.textContent = "Montando a planilha…";
    try {
      const r = await pedir({ exportar: 1 }, x.tipo === "sap" ? { tipo: "sap", texto: x.texto } : { tipo: "solicitacoes", pergunta: x.pergunta });
      const arquivo = await r.blob();
      const hoje = new Date().toLocaleDateString("sv-SE");
      const a = el("a", { href: URL.createObjectURL(arquivo), download: `bella-${x.tipo === "sap" ? "sap" : "solicitacoes"}-${hoje}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      b.textContent = rotulo;
    } catch (e) {
      b.textContent = `Não consegui montar a planilha (${e instanceof ErroConsulta ? e.message : "erro inesperado"}). Tentar de novo`;
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

const dataCurta = (iso) => { const d = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return d ? `${d[3]}/${d[2]}/${d[1]}` : String(iso || ""); };
const maiuscula = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;

function seloBloqueio(b) {
  if (!b) return el("span", { className: "etiqueta verde", textContent: "Liberado" });
  return el("span", { className: `etiqueta ${/total/i.test(b) ? "vermelho" : "amarelo"}`, textContent: maiuscula(b) });
}

// Codigo do SAP que a Bella consultou: texto, tipo, grupo, bloqueio, origem e o que usar no lugar
function cartaoSap(c) {
  const origem = c.solicitacoes && c.solicitacoes.length
    ? [document.createTextNode(c.solicitacoes.length > 1 ? "Webformat, solicitações " : "Webformat, solicitação "),
      ...c.solicitacoes.flatMap((n, i) => [i ? document.createTextNode(", ") : null, botaoSolicitacao(String(n))].filter(Boolean))]
    : c.origem ? [document.createTextNode(maiuscula(c.origem))] : null;
  const campos = [
    ["Tipo", c.tipo ? [document.createTextNode(c.tipo)] : null],
    ["Grupo de mercadorias", c.gm ? [document.createTextNode(c.gm_nome ? `${c.gm} · ${c.gm_nome}` : c.gm)] : null],
    ["Criado em", c.criado_em ? [document.createTextNode(dataCurta(c.criado_em))] : null],
    ["Origem", origem],
  ].filter(([, v]) => v);
  const u = c.usar_no_lugar;
  return el("div", { className: "cartao-sap" + (c.bloqueio ? " bloqueado" : "") },
    el("div", { className: "cs-topo" }, botaoCodigo(c.codigo), seloBloqueio(c.bloqueio)),
    c.texto ? el("p", { className: "cs-texto", textContent: c.texto }) : null,
    el("dl", { className: "cs-campos" }, ...campos.map(([r, v]) => el("div", {}, el("dt", { textContent: r }), el("dd", {}, ...v)))),
    u ? el("p", { className: "cs-usar" }, el("strong", { textContent: "Use no lugar: " }), botaoCodigo(u.codigo),
      u.texto ? document.createTextNode(` ${u.texto} `) : null, u.bloqueio ? seloBloqueio(u.bloqueio) : null) : null,
    c.catalogo_de ? el("p", { className: "cs-rodape", textContent: `Materiais do SAP de ${c.catalogo_de}` }) : null);
}

function desenhar(m) {
  if (m.de === "pessoa") {
    return el("div", { className: "msg da-pessoa", title: horaDe(m.em) },
      el("button", { type: "button", className: "editar so-ultima", title: "Editar a pergunta (↑)", ariaLabel: "Editar a pergunta",
        onclick: editarUltima }, icone("editar")),
      el("div", { className: "balao" }, ...markdown(m.texto)));
  }
  const corpo = m.ficha ? [montarFicha(m.texto, m.ficha)] : markdown(m.texto, !m.erro);
  const v = m.veredito && typeof m.veredito === "object" && VEREDITOS[m.veredito.tipo] ? m.veredito : null;
  // proximos passos do veredito e, depois, "Ver mais" e a planilha
  const botoes = [
    ...(v && Array.isArray(v.passos) ? v.passos.slice(0, 4).map(botaoPasso).filter(Boolean) : []),
    m.verMais ? el("button", { type: "button", className: "sugestao", textContent: "Ver mais", onclick: () => enviar("ver mais") }) : null,
    m.exportar ? botaoPlanilha(m.exportar) : null,
  ].filter(Boolean);
  const cartoes = Array.isArray(m.cartoes) && m.cartoes.length
    ? el("div", { className: "cartoes-sap" }, ...m.cartoes.slice(0, 3).map(cartaoSap))
    : Array.isArray(m.parecidos) && m.parecidos.length
    ? el("div", { className: "parecidos" }, ...m.parecidos.slice(0, 6).map(cartaoParecido)) : null;
  return el("div", { className: "msg da-bella" + (m.erro ? " erro" : "") }, avatar(),
    el("div", { className: "coluna" }, v ? cabecaDoVeredito(v) : null, el("div", { className: "balao" }, ...corpo), cartoes,
      v ? palavrasProcuradas(v) : null, botoes.length ? el("div", { className: "sugestoes" }, ...botoes) : null, botoesAvaliar(m)));
}

// ------------------------------------------------------------ veredito (Fase 2): etiqueta colorida, frase e proximos passos
// Vem da funcao (da ultima consulta ao SAP da mensagem), nunca e deduzido aqui do texto.
const VEREDITOS = { achei: ["ok", "✓"], porem: ["atencao", "!"], parecido: ["atencao", "◐"], nao_achei: ["nao", "✕"] };

function cabecaDoVeredito(v) {
  const [cor, icone] = VEREDITOS[v.tipo];
  return el("div", { className: "veredito" },
    el("span", { className: `selo-veredito ${cor}` }, el("span", { ariaHidden: "true", textContent: icone }), String(v.rotulo || "")),
    v.frase ? el("span", { className: "frase-veredito", textContent: String(v.frase) }) : null);
}

// "Procurei por": tocar numa palavra refaz a busca sem ela (com uma palavra so, nao ha o que tirar)
function palavrasProcuradas(v) {
  const ps = Array.isArray(v.palavras) ? v.palavras.map(String).filter(Boolean).slice(0, 8) : [];
  if (!ps.length) return null;
  return el("div", { className: "entendi" }, el("span", { textContent: "Procurei por" }),
    ...ps.map((p) => ps.length > 1
      ? el("button", { type: "button", className: "termo", textContent: p, title: `Procurar de novo sem “${p}”`,
        onclick: () => enviar(`já existe ${ps.filter((x) => x !== p).join(" ")}?`) })
      : el("span", { className: "termo", textContent: p })));
}

function botaoPasso(p) {
  if (!p || !p.rotulo) return null;
  if (p.catalogo) {
    return el("button", { type: "button", className: "sugestao", textContent: `⌕ ${p.rotulo}`, onclick: () => abrirCatalogoCom(String(p.catalogo)) });
  }
  if (p.pergunta) return el("button", { type: "button", className: "sugestao", textContent: String(p.rotulo), onclick: () => enviar(String(p.pergunta)) });
  return null;
}

// "VALVULA GAVETA ⟨bloqueio=sem;gm=024⟩" (o mesmo formato da planilha) -> abre "Procurar material" com isso
function abrirCatalogoCom(t) {
  const m = t.match(/⟨([^⟩]*)⟩\s*$/);
  const p = new URLSearchParams();
  const texto = (m ? t.slice(0, m.index) : t).trim();
  if (texto) p.set("texto", texto);
  for (const par of (m ? m[1].split(";") : [])) {
    const [k, val] = par.split("=");
    if (["bloqueio", "tipo", "gm", "usar", "errado"].includes(k) && val) p.set(k, val);
  }
  const q = p.toString();
  abrirLinkDoCatalogo(`#catalogo${q ? `&${q}` : ""}`);
}

function adicionar(m) {
  m.em = m.em || Date.now();
  historico.push(m);
  salvar();
  if ($("app-vazia-oi")) { $("app-vazia-oi").remove(); marcarVazia(); }
  if (cat.aberto && m.de === "bella") marcarNovidade(true);
  const n = desenhar(m);
  n.dataset.i = String(historico.length - 1);
  $("conversa").append(n);
  marcarUltimas();
  rolar();
  desenharTitulo();
  desenharConversas();   // a conversa aberta entra (ou sobe) na lista do menu
  return n;
}

// "Refazer" e "Editar" so aparecem na ultima resposta e na ultima pergunta
function marcarUltimas() {
  const c = $("conversa");
  for (const n of c.querySelectorAll(".msg.ultima")) n.classList.remove("ultima");
  const j = historico.map((m) => m.de).lastIndexOf("pessoa");
  for (const i of new Set([historico.length - 1, j])) {
    if (i >= 0) c.querySelector(`.msg[data-i="${i}"]`)?.classList.add("ultima");
  }
}

// Bella pensando: pontinhos, uma frase e, embaixo, o que ela ja consultou (cada "consultando" da funcao vira um passo)
function digitando(texto) {
  const n = el("div", { className: "msg da-bella digitando" }, avatar(),
    el("div", { className: "coluna" },
      el("div", { className: "balao" }, el("span", { className: "pontinhos", ariaHidden: "true" }, el("i"), el("i"), el("i")),
        el("span", { className: "digitando-texto", textContent: texto || "Deixa comigo, já estou procurando…" })),
      el("ul", { className: "passos" })));
  $("conversa").append(n);
  rolar();
  return n;
}

function passo(aviso, rotulo) {
  const lista = aviso.querySelector(".passos");
  if (!lista) return;
  for (const li of lista.children) li.classList.add("feito");
  if (lista.lastElementChild?.textContent === rotulo) return;
  lista.append(el("li", { textContent: rotulo }));
}

// sugestoes da conversa vazia: [icone, cor, pergunta, explicacao]
const SUGESTOES = [
  ["⌕", "c-ciano", "Já existe válvula gaveta DN 100?", "procura nos materiais do SAP"],
  ["▤", "c-amarelo", "Como estão as minhas solicitações?", "situação e último trâmite"],
  ["⏱", "c-verde", "Quantas estão com a CH há mais de 48 h úteis?", "a fila agora"],
  ["▶", "c-laranja", "Como pedir um material novo?", "passo a passo e vídeo"],
];
const DICAS = [
  "cole o texto do jeito que está no pedido, abreviado mesmo: VLV, GAV, SOLD, DN, PN valem.",
  "clique num número de solicitação ou num código do SAP para abrir os detalhes.",
  "sentiu falta de alguma coisa? Escreva “feedback” e conte o que faltou.",
  "lista grande? Peça a planilha para abrir no Excel.",
  "no painel, a tela Em aberto mostra com quem está cada uma; clique numa barra para ver a lista.",
  "“o que a CH pediu na 1234?” traz o motivo da pendência, lido na hora no Webformat.",
];

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function boasVindas() {
  const icone = { "Bom dia": "☀️", "Boa tarde": "🌤️", "Boa noite": "🌙" }[saudacao()];
  return el("div", { className: "ola", id: "app-vazia-oi" },
    el("img", { src: "img/bella.png", alt: "", width: 96, height: 104 }),
    el("div", { className: "fala2" },
      el("h2", { textContent: `${saudacao()}${nome && !esperandoNome ? `, ${nome}` : ""}! ${icone}` }),
      el("p", { textContent: "Bora achar esse material? Me conta o que precisa." }),
      !codigoDoTime || ehSessao(codigo) ? null : el("p", { className: "aviso-time", textContent: "🔐 Você entrou com o código do time, que vai deixar de valer. " +
        "Quem é da Meetup entra com a conta Microsoft; usuários da Sabesp recebem a chave pessoal do Luiz Henrique Brambilla Teixeira." })));
}

function desenharSugestoes() {
  const dica = DICAS[Math.floor(Date.now() / 864e5) % DICAS.length];  // uma por dia
  $("sugs").replaceChildren(
    ...SUGESTOES.map(([ic, cor, q, sub]) => el("button", { type: "button", className: "sug", onclick: () => enviar(q) },
      el("span", { className: `ic ${cor}`, ariaHidden: "true", textContent: ic }), q, el("small", { textContent: sub }))),
    el("p", { className: "dica-dia" }, el("b", { textContent: "💡 Dica: " }), dica));
}

const marcarVazia = () => $("chat").classList.toggle("vazia", !historico.length);

function redesenhar() {
  $("conversa").replaceChildren(...(historico.length
    ? historico.map((m, i) => { const n = desenhar(m); n.dataset.i = String(i); return n; }) : [boasVindas()]));
  marcarUltimas();
  marcarVazia();
  desenharTitulo();
  desenharConversas();
  desenharPerfil();
  rolar();
}

// ------------------------------------------------------------ conversas (menu lateral)
// Com chave pessoal ou conta Microsoft ficam no historico (banco de dados, so da pessoa, 30 dias desde
// a ultima mensagem): reabre amanha ou em outro computador. Sem isso, so nesta aba (fechou, some).

let conversas = [];   // [{sessao, titulo, em, historico?}] das outras conversas (a atual fica em `historico`)
try { conversas = JSON.parse(ler(sessionStorage, "consulta-conversas") || "[]"); } catch (e) { conversas = []; }
if (!Array.isArray(conversas)) conversas = [];
let nuvem = false;    // o historico respondeu: a lista vem dele e cada mensagem nova vai para ele
// na aba fica o que cabe: as 10 primeiras com a conversa, as outras so com o titulo
const salvarConversas = () => guardar(sessionStorage, "consulta-conversas",
  JSON.stringify(conversas.slice(0, 50).map((c, i) => i < 10 ? c : { sessao: c.sessao, titulo: c.titulo, em: c.em })));
const tituloDaConversa = (c) => c.titulo || tituloDe(c.historico || []);
const quandoDe = (h) => (h.length && h[h.length - 1].em) || Date.now();

const tituloDe = (h) => {
  const p = h.find((m) => m.de === "pessoa");
  const t = p ? textoPuro(p.texto).replace(/\s+/g, " ").trim() : "";
  return t ? maiuscula(t.length > 42 ? `${t.slice(0, 40)}…` : t) : "Nova conversa";
};

// com o catalogo aberto o titulo e dele (a resposta que chega por tras nao troca)
function desenharTitulo() { $("titulo").textContent = cat.aberto ? "Procurar material" : pn.aberto ? "Painel" : tituloDe(historico); }

function guardarAtual() {
  if (!historico.length) return;
  conversas = [{ sessao, historico, titulo: tituloDe(historico), em: quandoDe(historico) },
    ...conversas.filter((c) => c.sessao !== sessao)].slice(0, 50);
  salvarConversas();
}

function grupoDaData(ms) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const d = hoje.getTime();
  return ms >= d ? "Hoje" : ms >= d - 864e5 ? "Ontem" : ms >= d - 6 * 864e5 ? "Últimos 7 dias" : "Mais antigas";
}

function desenharConversas() {
  const itens = [];
  if (historico.length) itens.push({ sessao, titulo: tituloDe(historico), em: quandoDe(historico), atual: true });
  for (const c of conversas) if (c.sessao !== sessao) itens.push(c);
  itens.sort((a, b) => (b.em || 0) - (a.em || 0));
  $("titulo-conversas").hidden = !itens.length;
  $("titulo-conversas").textContent = nuvem ? "Conversas" : "Conversas desta aba";
  $("titulo-conversas").title = nuvem ? "Ficam guardadas por 30 dias, só para você" : "Somem quando a aba é fechada";
  const nos = [];
  let grupo = "";
  for (const c of itens) {
    const g = nuvem ? grupoDaData(c.em || 0) : "";
    if (g && g !== grupo) { grupo = g; nos.push(el("h3", { className: "grupo-data", textContent: g })); }
    nos.push(itemDaConversa(c));
  }
  $("lista-conversas").replaceChildren(...nos);
}

function itemDaConversa(c) {
  const t = tituloDaConversa(c);
  const abrir = el("button", { type: "button", className: "abrir", textContent: t, title: t });
  abrir.onclick = () => abrirConversa(c.sessao, abrir);
  if (c.atual && !cat.aberto && !pn.aberto) abrir.setAttribute("aria-current", "true");
  if (c.atual && cat.novidade) abrir.classList.add("novidade");
  // o primeiro clique pergunta ("Apagar?"); o segundo apaga
  const x = el("button", { type: "button", className: "apagar", textContent: "×", title: "Apagar esta conversa",
    ariaLabel: `Apagar a conversa “${t}”` });
  const voltar = () => { x.classList.remove("confirmar"); x.textContent = "×"; x.title = "Apagar esta conversa"; };
  x.onclick = () => {
    if (!x.classList.contains("confirmar")) {
      x.classList.add("confirmar");
      x.textContent = "Apagar?";
      x.title = "Clique de novo para apagar";
      return;
    }
    apagarConversa(c.sessao, x);
  };
  x.onblur = voltar;
  return el("div", { className: "item-conversa" }, abrir, x);
}

async function abrirConversa(s, botao) {
  fecharLado();
  fecharCatalogo();
  fecharPainel();
  if (s === sessao || ocupado) return;
  const c = conversas.find((x) => x.sessao === s);
  if (!c) return;
  if (!c.historico) {
    // do historico: so o titulo veio na lista; a conversa vem agora
    if (botao) { botao.textContent = "Abrindo…"; botao.disabled = true; }
    try {
      const d = await chamar({ historico: 1 }, { acao: "abrir", sessao: s });
      c.historico = Array.isArray(d.mensagens) ? d.mensagens : [];
    } catch (e) {
      if (botao) {
        botao.textContent = "Não consegui abrir. Tente de novo";
        setTimeout(desenharConversas, 2500);
      }
      return;
    }
    if (s === sessao || ocupado || !conversas.includes(c)) return;
  }
  cancelarEdicao(true);
  espera++;
  guardarAtual();
  conversas = conversas.filter((x) => x.sessao !== s);
  salvarConversas();
  sessao = c.sessao;
  historico = c.historico;
  guardar(sessionStorage, "consulta-sessao", sessao);
  salvarNaAba();
  redesenhar();
}

async function apagarConversa(s, botao) {
  if (ocupado) return;
  pendentes.delete(s);
  if (nuvem) {
    if (botao) { botao.textContent = "Apagando…"; botao.disabled = true; }
    try {
      await chamar({ historico: 1 }, { acao: "apagar", sessao: s });
    } catch (e) {
      // nao apagou: avisa no proprio botao e a lista volta como estava
      if (botao) { botao.textContent = "Não deu"; setTimeout(desenharConversas, 2000); }
      return;
    }
  }
  conversas = conversas.filter((x) => x.sessao !== s);
  salvarConversas();
  if (s !== sessao) { desenharConversas(); return; }
  // era a conversa aberta: fica uma nova no lugar
  cancelarEdicao(true);
  espera++;
  historico = [];
  salvarNaAba();
  sessao = novoId();
  guardar(sessionStorage, "consulta-sessao", sessao);
  redesenhar();
}

// ------------------------------------------------------------ historico no banco de dados
const pendentes = new Map();   // sessao -> conversa esperando para ir ao historico
let relogioNuvem = 0;

// junta as mensagens de um mesmo instante (pergunta, resposta, avaliacao) numa ida so
function agendarNuvem(s, h) {
  if (!nuvem || !h.length) return;
  pendentes.set(s, h);
  clearTimeout(relogioNuvem);
  relogioNuvem = setTimeout(mandarPendentes, 1200);
}

async function mandarPendentes() {
  const lote = [...pendentes];
  pendentes.clear();
  for (const [s, h] of lote) {
    try {
      await chamar({ historico: 1 }, { acao: "salvar", sessao: s, titulo: tituloDe(h), mensagens: h.slice(-60) });
    } catch (e) { /* fica na aba; vai de novo na proxima mensagem */ }
  }
}

// Depois de entrar com chave pessoal ou conta Microsoft: a lista vem do historico, e o que so estava
// nesta aba (de antes) sobe para ele. Uma conversa do historico so e lida quando a pessoa abre.
let historicoPedido = false;
async function carregarHistorico() {
  if (historicoPedido) return;
  historicoPedido = true;
  let d;
  try {
    d = await chamar({ historico: 1 }, { acao: "listar" });
  } catch (e) {
    historicoPedido = false;   // tenta de novo na proxima entrada
    return;
  }
  if (!codigo || !Array.isArray(d.conversas)) return;
  nuvem = true;
  const doBanco = d.conversas.filter((c) => c && typeof c.sessao === "string")
    .map((c) => ({ sessao: c.sessao, titulo: String(c.titulo || ""), em: Date.parse(c.atualizado_em) || 0 }));
  const noBanco = new Set(doBanco.map((c) => c.sessao));
  const soNaAba = conversas.filter((c) => !noBanco.has(c.sessao) && Array.isArray(c.historico) && c.historico.length);
  for (const c of soNaAba) agendarNuvem(c.sessao, c.historico);
  if (historico.length && !noBanco.has(sessao)) agendarNuvem(sessao, historico);
  conversas = [...soNaAba.map((c) => ({ ...c, titulo: tituloDaConversa(c), em: c.em || quandoDe(c.historico) })), ...doBanco]
    .filter((c) => c.sessao !== sessao).sort((a, b) => (b.em || 0) - (a.em || 0)).slice(0, 50);
  salvarConversas();
  desenharConversas();
}

// menu lateral no celular
function abrirLado() { $("lado").classList.add("aberto"); $("cortina").hidden = false; }
function fecharLado() { $("lado").classList.remove("aberto"); $("cortina").hidden = true; }

function desenharPerfil() {
  $("perfil-nome").textContent = nome || "Você";
  $("iniciais").textContent = nome ? nome[0].toUpperCase() : "?";
}

// ------------------------------------------------------------ conversa

let ocupado = false;
let espera = 0;
let parada = null;  // AbortController da resposta em andamento (botao "Parar")

// O botao do compositor: enviar (apagado com a caixa vazia) ou, enquanto a Bella responde, parar.
function atualizarBotao() {
  const b = $("enviar");
  b.classList.toggle("parar", ocupado);
  b.ariaLabel = ocupado ? "Parar a resposta" : "Enviar";
  b.title = ocupado ? "Parar a resposta" : "Enviar (Enter)";
  b.replaceChildren(icone(ocupado ? "parar" : "enviar"));
  b.disabled = !ocupado && !$("mensagem").value.trim();
  for (const id of ["nova", "nova-cel"]) {
    $(id).disabled = ocupado;
    $(id).title = ocupado ? "Espere a resposta terminar (ou pare a resposta)" : `Começar uma conversa nova (${CTRL}+Shift+O)`;
  }
  $("lista-conversas").classList.toggle("travada", ocupado);
  $("chat").classList.toggle("ocupado", ocupado);
}

function pararResposta() {
  if (!ocupado || !parada) return;
  espera++;  // tambem para de esperar o Webformat
  parada.abort();
}

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

// enquanto a IA consulta (o texto escrito ate ali sai da tela)
const CONSULTANDO = {
  consultar_solicitacoes: "Consultando as solicitações…", minhas_solicitacoes: "Procurando as suas solicitações…",
  procurar_solicitante: "Procurando o seu nome no Webformat…", confirmar_solicitante: "Guardando o seu nome…",
  ver_solicitacao: "Abrindo a solicitação…", ajuda_pendencia: "Abrindo a solicitação…",
  catalogo_sap: "Procurando nos materiais do SAP…", buscar_material: "Olhando o histórico de materiais…",
  evolucao_da_fila: "Olhando a evolução da fila…",
};
const rotuloConsulta = (fs) => CONSULTANDO[(fs || [])[0]] || "Consultando a base de conhecimento…";

// refazer: id da resposta que sai da memoria da Bella ("Refazer" ou pergunta editada)
async function enviar(texto, refazer = null) {
  texto = String(texto || "").trim();
  if (!texto || ocupado || !codigo) return;
  fecharPainel();
  ocupado = true;
  parada = new AbortController();
  atualizarBotao();
  adicionar({ de: "pessoa", texto });
  const aviso = digitando();
  // a resposta aparecendo enquanto a Bella escreve
  let vivo = null, textoVivo = "", quadro = 0;
  const mostrar = () => {
    quadro = 0;
    if (vivo) { vivo.balao.replaceChildren(...markdown(textoVivo)); rolar(false); }
  };
  const aoEvento = (evento, d) => {
    if (evento === "texto") {
      textoVivo += d.t || "";
      if (!vivo) {
        aviso.hidden = true;
        const balao = el("div", { className: "balao" });
        vivo = { no: el("div", { className: "msg da-bella escrevendo" }, avatar(), el("div", { className: "coluna" }, balao)), balao };
        $("conversa").append(vivo.no);
      }
      if (!quadro) quadro = requestAnimationFrame(mostrar);
    } else if (evento === "consultando") {
      textoVivo = "";
      if (vivo) { vivo.no.remove(); vivo = null; }
      aviso.hidden = false;
      passo(aviso, rotuloConsulta(d.ferramentas));
      rolar();
    }
  };
  const limpar = () => {
    if (quadro) cancelAnimationFrame(quadro);
    quadro = 0;
    if (vivo) vivo.no.remove();
    vivo = null;
  };
  try {
    // tela: "nova" -> a funcao manda o veredito e a IA nao anuncia "achei" (a etiqueta ja diz)
    const d = await conversarAoVivo({ sessao, navegador, texto, tela: "nova", ...(refazer ? { refazer } : {}) },
      aoEvento, parada.signal);
    limpar();
    if (d.pedido) {
      aviso.hidden = false;
      await acompanhar(d, aviso);
    } else {
      aviso.remove();
      adicionar({ de: "bella", texto: d.resposta || "", mensagem: d.mensagem || null, verMais: !!d.ver_mais,
        exportar: d.exportar && typeof d.exportar === "object" ? d.exportar : null,
        cartoes: Array.isArray(d.cartoes) ? d.cartoes : null, veredito: d.veredito && typeof d.veredito === "object" ? d.veredito : null,
        parecidos: Array.isArray(d.parecidos) ? d.parecidos.slice(0, 6) : null });
    }
  } catch (e) {
    const parcial = textoVivo;
    limpar();
    aviso.remove();
    if (parada.signal.aborted) {
      adicionar({ de: "bella", texto: (parcial ? `${parcial}\n\n` : "") + "_Resposta interrompida._" });
    } else {
      adicionar({ de: "bella", erro: true,
        texto: `Não consegui responder agora (${e instanceof ErroConsulta ? e.message : "erro inesperado"}). Tente de novo em instantes.` });
    }
  } finally {
    ocupado = false;
    parada = null;
    atualizarBotao();
    $("mensagem").focus();
  }
}

function novaConversa() {
  fecharLado();
  if (ocupado) return;   // primeiro termina (ou para) a resposta desta conversa
  fecharCatalogo();
  fecharPainel();
  cancelarEdicao(true);
  espera++;
  guardarAtual();
  historico = [];
  salvarNaAba();
  sessao = novoId();
  guardar(sessionStorage, "consulta-sessao", sessao);
  redesenhar();
  $("mensagem").focus();
}

// ------------------------------------------------------------ refazer e editar (so a ultima pergunta)
let editando = false;

// a ultima pergunta: onde esta na conversa e o id da resposta dela na memoria da Bella (se tiver)
function ultimaTroca() {
  const j = historico.map((m) => m.de).lastIndexOf("pessoa");
  if (j < 0) return null;
  const r = historico.slice(j + 1).find((m) => m.mensagem);
  return { j, texto: historico[j].texto, refazer: r ? r.mensagem : null };
}

// tira a ultima pergunta (e a resposta) da tela e pergunta de novo
function perguntarDeNovo(u, texto) {
  historico = historico.slice(0, u.j);
  salvarNaAba();
  redesenhar();
  enviar(texto, u.refazer);
}

function refazer() {
  if (ocupado) return;
  const u = ultimaTroca();
  if (!u) return;
  cancelarEdicao(true);
  perguntarDeNovo(u, u.texto);
}

// a ultima pergunta volta para a caixa; ao enviar, ela e a resposta dela sao trocadas
function editarUltima() {
  if (ocupado) return;
  const u = ultimaTroca();
  if (!u) return;
  fecharCatalogo();
  fecharPainel();
  editando = true;
  $("editando").hidden = false;
  $("chat").classList.add("com-edicao");
  const t = $("mensagem");
  t.value = u.texto;
  ajustarAltura();
  atualizarBotao();
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);
}

function cancelarEdicao(limpar) {
  if (!editando) return;
  editando = false;
  $("editando").hidden = true;
  $("chat").classList.remove("com-edicao");
  if (limpar) {
    $("mensagem").value = "";
    ajustarAltura();
    atualizarBotao();
  }
}

// ------------------------------------------------------------ acompanhar pelo WhatsApp
// Painel do botao "WhatsApp": a pessoa confirma como aparece no Webformat e o numero;
// a Bella acompanha as abertas dela (pendencia tecnica e codigo definitivo).
// Em teste (modo sombra), os avisos aparecem aqui em vez de sair para o WhatsApp.

let wa = null;          // ultimo estado vindo da funcao
let waTrocando = false; // "trocar numero" ou "trocar nome" com o acompanhamento ligado

// *negrito* do WhatsApp -> <strong>, o resto como texto
function textoWhatsapp(t) {
  const p = el("p", { className: "wa-msg" });
  String(t).split(/(\*[^*\n]+\*)/).forEach((parte) => {
    p.append(/^\*[^*\n]+\*$/.test(parte) ? el("strong", { textContent: parte.slice(1, -1) }) : parte);
  });
  return p;
}

const waQuando = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function waErro(msg) {
  const velho = $("wa-corpo").querySelector(".wa-erro");
  if (velho) velho.remove();
  if (msg) $("wa-corpo").prepend(el("p", { className: "wa-erro", role: "alert", textContent: msg }));
}

async function waChamar(corpo) {
  try {
    wa = corpo ? await chamar({ whatsapp: 1 }, corpo) : await chamar({ whatsapp: 1 });
    return true;
  } catch (e) {
    waErro(e instanceof ErroConsulta ? e.message : "Não deu para falar com a Bella agora. Tente de novo.");
    return false;
  }
}

function waEscolhaDeNome(sugestoes) {
  const caixa = el("fieldset", { className: "wa-campo" }, el("legend", { textContent: "Como você aparece no Webformat" }));
  if (sugestoes.length) {
    sugestoes.forEach((s, i) => {
      const r = el("input", { type: "radio", name: "wa-solicitante", value: s.nome, checked: i === 0 && sugestoes.length === 1 });
      caixa.append(el("label", { className: "wa-opcao" }, r, ` ${s.nome} `,
        el("span", { className: "wa-dica", textContent: `(${s.solicitacoes} ${s.solicitacoes === 1 ? "solicitação" : "solicitações"})` })));
    });
  } else {
    caixa.append(el("p", { className: "wa-dica", textContent: "Procure o seu nome como ele aparece no Webformat:" }));
  }
  const busca = el("input", { type: "text", maxLength: 120, placeholder: "Outro nome: digite e procure", id: "wa-busca" });
  const botao = el("button", { type: "button", className: "wa-secundario", textContent: "Procurar" });
  botao.addEventListener("click", async () => {
    const nomeBusca = busca.value.trim();
    if (nomeBusca.length < 3) { waErro("Digite pelo menos 3 letras do nome."); return; }
    botao.disabled = true;
    try {
      const d = await chamar({ whatsapp: 1 }, { acao: "procurar", nome: nomeBusca });
      wa = { ...wa, solicitante: null, sugestoes: d.sugestoes || [] };
      waTrocando = true;
      waDesenhar();
      if (!(d.sugestoes || []).length) waErro("Nenhum solicitante com esse nome. Tente só o primeiro e o último nome.");
    } catch (e) {
      waErro(e instanceof ErroConsulta ? e.message : "Não deu para procurar agora.");
    } finally { botao.disabled = false; }
  });
  busca.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); botao.click(); } });
  caixa.append(el("div", { className: "wa-linha" }, busca, botao));
  return caixa;
}

function waFormulario() {
  const f = el("form", { className: "wa-form", autocomplete: "off" });
  f.append(el("p", { textContent: "Receba no WhatsApp um aviso quando uma solicitação sua no Webformat voltar com pendência técnica da CH ou receber o código definitivo. As que você abrir depois entram sozinhas." }));
  f.append(el("p", { className: "wa-conta" }, "Sua conta na Bella: ", el("strong", { textContent: wa.email || "?" })));
  if (wa.solicitante && !waTrocando) {
    const trocar = el("button", { type: "button", className: "link", textContent: "trocar" });
    trocar.addEventListener("click", () => { waTrocando = true; wa = { ...wa, solicitante: null, sugestoes: wa.sugestoes || [] }; waDesenhar(); });
    f.append(el("p", { className: "wa-campo" }, "No Webformat você aparece como ", el("strong", { textContent: wa.solicitante }), " · ", trocar),
      el("input", { type: "hidden", name: "wa-solicitante", value: wa.solicitante }));
  } else {
    f.append(waEscolhaDeNome(wa.sugestoes || []));
  }
  const numero = el("input", { type: "tel", id: "wa-numero", inputMode: "tel", maxLength: 20, required: true,
    placeholder: "(11) 91234-5678", autocomplete: "tel-national" });
  f.append(el("label", { className: "wa-campo", htmlFor: "wa-numero" }, "Seu WhatsApp (DDD + celular)"), numero);
  const aceite = el("input", { type: "checkbox", id: "wa-aceite", required: true });
  f.append(el("label", { className: "wa-aceite", htmlFor: "wa-aceite" }, aceite,
    " Autorizo a Bella a me mandar avisos das minhas solicitações por WhatsApp. Posso parar quando quiser, e aí o número é apagado."));
  const ativar = el("button", { type: "submit", className: "wa-principal", textContent: wa.ativo ? "Salvar" : "Ativar acompanhamento" });
  f.append(el("div", { className: "wa-botoes" }, ativar));
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const escolhido = f.querySelector('input[name="wa-solicitante"]:checked, input[type="hidden"][name="wa-solicitante"]');
    if (!escolhido) { waErro("Escolha como você aparece no Webformat (ou procure pelo nome)."); return; }
    ativar.disabled = true;
    const ok = await waChamar({ acao: "ativar", whatsapp: numero.value, solicitante: escolhido.value, aceite: aceite.checked });
    ativar.disabled = false;
    if (ok) { waTrocando = false; waDesenhar(); }
  });
  return f;
}

function waAcompanhando() {
  const caixa = el("div", { className: "wa-ativo" });
  caixa.append(el("p", { className: "wa-ok" }, "✅ Acompanhando as solicitações de ", el("strong", { textContent: wa.solicitante }),
    " no WhatsApp ", el("strong", { textContent: wa.whatsapp }), "."));
  const abertas = wa.abertas || [];
  caixa.append(el("h3", { textContent: abertas.length ? `Em aberto agora (${abertas.length})` : "Nenhuma solicitação em aberto agora" }));
  if (abertas.length) {
    caixa.append(el("ul", { className: "wa-lista" }, ...abertas.map((s) => el("li", {},
      el("strong", { textContent: String(s.numero) }), ` ${s.descricao || ""} `,
      el("span", { className: `wa-situacao${s.pendencia ? " pendencia" : ""}`, textContent: s.pendencia ? "pendência técnica" : s.situacao })))));
  }
  const avisos = wa.avisos || [];
  caixa.append(el("h3", { textContent: wa.modo === "sombra" ? "Avisos que a Bella mandaria (ainda não enviados)" : "Últimos avisos" }));
  if (!avisos.length) {
    caixa.append(el("p", { className: "wa-dica", textContent: "Nenhum ainda. Quando uma solicitação sua voltar com pendência técnica ou receber o código, o aviso aparece aqui." }));
  }
  avisos.forEach((a) => {
    const meta = [waQuando(a.criado_em), a.atraso_min === null ? "" : `${a.atraso_min} min depois do trâmite no Webformat`,
      a.enviado ? "enviado" : "não enviado (em desenvolvimento)"].filter(Boolean).join(" · ");
    caixa.append(el("div", { className: "wa-aviso" }, textoWhatsapp(a.texto), el("p", { className: "wa-dica", textContent: meta })));
  });
  if (wa.boas_vindas) {
    caixa.append(el("details", { className: "wa-boas-vindas" }, el("summary", { textContent: "Mensagem de boas-vindas" }),
      el("div", { className: "wa-aviso" }, textoWhatsapp(wa.boas_vindas))));
  }
  const trocar = el("button", { type: "button", className: "wa-secundario", textContent: "Trocar número ou nome" });
  trocar.addEventListener("click", () => { waTrocando = true; waDesenhar(); });
  const parar = el("button", { type: "button", className: "wa-perigo", textContent: "Parar acompanhamento" });
  parar.addEventListener("click", async () => {
    parar.disabled = true;
    if (await waChamar({ acao: "parar" })) waDesenhar();
    parar.disabled = false;
  });
  caixa.append(el("div", { className: "wa-botoes" }, trocar, parar));
  return caixa;
}

function waDesenhar() {
  $("wa-teste").hidden = wa?.modo !== "sombra";
  $("wa-corpo").replaceChildren(wa.ativo && !waTrocando ? waAcompanhando() : waFormulario());
}

async function abrirWhatsapp() {
  const painel = $("painel-whatsapp");
  waTrocando = false;
  $("wa-corpo").replaceChildren(el("p", { className: "wa-dica", textContent: "Carregando…" }));
  if (!painel.open) painel.showModal();
  if (await waChamar()) waDesenhar();
}

// ------------------------------------------------------------ procurar material (catalogo do SAP com filtros)
// Busca enquanto a pessoa digita (espera 350 ms parada); a busca anterior e cancelada.

const cat = { aberto: false, opcoes: null, pagina: 1, bloqueio: "", pedido: null, espera: 0, ultimo: null, novidade: false };
// link de uma busca (#catalogo&texto=...): aberto antes de entrar, vale depois da entrada
let linkPendente = /^#catalogo(&|$)/.test(location.hash) ? location.hash : "";

// O endereco guarda a busca, para mandar no Teams: #catalogo&texto=luva pvc&tipo=ZMAT&gm=024&bloqueio=sem
function linkDaBusca(f) {
  const p = new URLSearchParams();
  if (f.texto) p.set("texto", f.texto);
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.gm) p.set("gm", f.gm);
  if (f.bloqueio) p.set("bloqueio", f.bloqueio);
  if (f.manda_usar_outro) p.set("usar", "1");
  if (f.tipo_errado) p.set("errado", "1");
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const q = p.toString();
  return `#catalogo${q ? `&${q}` : ""}`;
}
// troca o endereco sem criar volta no navegador (e sem disparar o hashchange)
const marcarEndereco = (hash) => history.replaceState(null, "", location.pathname + location.search + hash);

function abrirLinkDoCatalogo(hash) {
  const p = new URLSearchParams(hash.replace(/^#catalogo&?/, ""));
  $("cat-texto").value = (p.get("texto") || "").slice(0, 120);
  $("cat-gm").value = (p.get("gm") || "").slice(0, 40);
  cat.bloqueio = ["sem", "compras", "total"].includes(p.get("bloqueio")) ? p.get("bloqueio") : "";
  $("cat-usar").checked = p.get("usar") === "1";
  $("cat-errado").checked = p.get("errado") === "1";
  cat.pagina = Math.max(1, Math.min(200, parseInt(p.get("pagina"), 10) || 1));
  const tipo = (p.get("tipo") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  // o tipo do link entra na lista mesmo antes das opcoes chegarem
  if (tipo && ![...$("cat-tipo").options].some((o) => o.value === tipo)) $("cat-tipo").append(el("option", { value: tipo, textContent: tipo }));
  $("cat-tipo").value = tipo;
  abrirCatalogo();
  buscarNoCatalogo();
}

// resposta da Bella chegou com o catalogo aberto: aviso no catalogo, bolinha no menu
function marcarNovidade(sim) {
  cat.novidade = sim;
  $("cat-novidade").hidden = !sim;
  $("abrir-lado").classList.toggle("novidade", sim);
  desenharConversas();
}

function filtrosDoCatalogo() {
  const gm = grupoDigitado($("cat-gm").value);
  return { texto: $("cat-texto").value.trim(), tipo: $("cat-tipo").value, gm, bloqueio: cat.bloqueio,
    manda_usar_outro: $("cat-usar").checked, tipo_errado: $("cat-errado").checked, pagina: cat.pagina };
}

// "024 · TUBOS E CONEXOES" (da lista), "024" ou "tubos e conexoes" (o nome) -> "024"
function grupoDigitado(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  const simples = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const pelaLista = (cat.opcoes?.grupos || []).find((g) =>
    t === `${g.codigo} · ${g.descricao || ""}`.trim() || simples(g.descricao) === simples(t));
  return pelaLista ? pelaLista.codigo : t.split(/[\s·]/)[0];
}

async function carregarOpcoesDoCatalogo() {
  if (cat.opcoes) return;
  try {
    cat.opcoes = await chamar({ catalogo: 1 });
  } catch (e) {
    return;   // sem as listas os filtros ainda funcionam digitando
  }
  const jaTem = new Set([...$("cat-tipo").options].map((o) => o.value));
  $("cat-tipo").append(...(cat.opcoes.tipos || []).filter((t) => !jaTem.has(t)).map((t) => el("option", { value: t, textContent: t })));
  $("cat-grupos").replaceChildren(...(cat.opcoes.grupos || []).map((g) =>
    el("option", { value: `${g.codigo} · ${g.descricao || ""}`.trim() })));
  if (cat.aberto && !cat.ultimo) desenharCatalogo(null);   // agora com a data dos materiais
}

function abrirCatalogo() {
  fecharLado();
  fecharPainel();
  cat.aberto = true;   // com a Bella respondendo, a resposta continua na conversa, por tras
  $("chat").classList.add("modo-catalogo");
  $("catalogo").hidden = false;
  $("atalho-material").setAttribute("aria-current", "true");
  desenharConversas();
  desenharTitulo();
  // o endereco mostra a busca que esta na tela (a ultima, se a pessoa voltou ao catalogo)
  marcarEndereco(cat.ultimo ? linkDaBusca(filtrosDoCatalogo()) : "#catalogo");
  carregarOpcoesDoCatalogo();
  if (!cat.ultimo) desenharCatalogo(null);
  $("cat-texto").focus();
}

function fecharCatalogo() {
  if (!cat.aberto) return;
  cat.aberto = false;
  $("chat").classList.remove("modo-catalogo");
  $("catalogo").hidden = true;
  $("atalho-material").removeAttribute("aria-current");
  marcarEndereco("");
  marcarNovidade(false);
  desenharTitulo();
}

function buscarNoCatalogo(espera = 0) {
  clearTimeout(cat.espera);
  cat.espera = setTimeout(async () => {
    const f = filtrosDoCatalogo();
    $("cat-limpar").hidden = !(f.tipo || f.gm || f.bloqueio || f.manda_usar_outro || f.tipo_errado);
    const vazio = !f.texto && !f.tipo && !f.gm && !f.manda_usar_outro && !f.tipo_errado && !f.bloqueio;
    if (cat.aberto) marcarEndereco(vazio ? "#catalogo" : linkDaBusca(f));
    if (vazio) {
      cat.pedido?.abort();
      cat.pedido = null;
      cat.ultimo = null;
      $("cat-corpo").classList.remove("carregando");
      desenharCatalogo(null);
      return;
    }
    cat.pedido?.abort();
    const meu = cat.pedido = new AbortController();
    $("cat-corpo").classList.add("carregando");
    try {
      const r = await pedir({ catalogo: 1 }, f, meu.signal);
      const d = await r.json();
      if (meu !== cat.pedido) return;
      cat.ultimo = d;
      desenharCatalogo(d);
    } catch (e) {
      if (meu !== cat.pedido || meu.signal.aborted) return;
      $("cat-corpo").replaceChildren(el("p", { className: "cat-aviso erro",
        textContent: `Não consegui procurar agora (${e instanceof ErroConsulta ? e.message : "erro inesperado"}). Tente de novo em instantes.` }));
    } finally {
      if (meu === cat.pedido) $("cat-corpo").classList.remove("carregando");
    }
  }, espera);
}

// rodape: de quando sao os materiais (e o aviso se a carga passou de 30 dias)
function dataDosMateriais() {
  const o = cat.opcoes;
  if (!o?.catalogo_de) return null;
  return el("p", { className: "cat-data" + (o.catalogo_antigo ? " antigo" : "") },
    `Materiais do SAP de ${o.catalogo_de}`, o.catalogo_antigo ? ` · ⚠️ ${o.catalogo_antigo}` : "");
}

const numeroBr = (n) => Number(n || 0).toLocaleString("pt-BR");

function seloSituacao(b) {
  if (!b) return el("span", { className: "etiqueta verde", textContent: "livre" });
  return el("span", { className: `etiqueta ${/total/i.test(b) ? "vermelho" : "amarelo"}`, textContent: b.replace(/^bloqueio /, "bloq. ") });
}

function perguntarSobre(codigo) {
  fecharCatalogo();
  enviar(`o que é o ${codigo}?`);
}

function desenharCatalogo(d) {
  const c = d?.contagem;
  $("cat-n-todos").textContent = c ? numeroBr(c.todos ?? c.livres + c.compras + c.total) : "";
  $("cat-n-livres").textContent = c ? numeroBr(c.livres) : "";
  $("cat-n-compras").textContent = c ? numeroBr(c.compras) : "";
  $("cat-n-total").textContent = c ? numeroBr(c.total) : "";
  for (const b of $("cat-bloqueio").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.bloqueio === cat.bloqueio));
  if (!d) {
    $("cat-corpo").replaceChildren(el("div", { className: "cat-vazio" },
      el("img", { src: "img/bella.png", alt: "", width: 72, height: 78 }),
      el("p", {}, el("strong", { textContent: "Me diga o que procurar 🔍" }),
        "Digite o texto ou o código do material, ou escolha um filtro. Eu procuro do mesmo jeito que na conversa: abreviado também vale."),
      dataDosMateriais()));
    return;
  }
  const maxPaginas = d.max_paginas || 200;
  const paginas = Math.max(1, Math.ceil(Math.min(d.total, d.por_pagina * maxPaginas) / d.por_pagina));
  const resumo = el("div", { className: "cat-resumo" },
    el("p", {}, el("strong", { textContent: d.total ? `${numeroBr(d.total)} ${d.total === 1 ? "código" : "códigos"}` : "Nenhum código" }),
      ` · procurei ${d.procurou}`, d.procurou_tambem_como ? ` (também como ${d.procurou_tambem_como.join(", ")})` : "",
      d.filtros?.length ? ` · ${d.filtros.join(" · ")}` : ""),
    el("div", { className: "cat-resumo-acoes" }, botaoLinkDaBusca(),
      d.texto_planilha && d.total ? botaoPlanilha({ tipo: "sap", total: d.total, texto: d.texto_planilha }) : null));
  if (!d.total) {
    $("cat-corpo").replaceChildren(resumo, el("div", { className: "cat-vazio" },
      el("img", { src: "img/bella.png", alt: "", width: 72, height: 78 }),
      el("div", {}, el("p", {}, el("strong", { textContent: "Não achei nada com isso 😕" }),
        "Tente menos palavras ou tire um filtro. Na conversa eu também procuro os parecidos."),
        $("cat-texto").value.trim() ? el("button", { type: "button", className: "sugestao", textContent: "Procurar parecidos na conversa",
          onclick: () => { const t = $("cat-texto").value.trim(); fecharCatalogo(); enviar(`já existe ${t}?`); } }) : null)));
    return;
  }
  const linhas = d.linhas.map((l) => el("tr", {},
    el("td", { className: "cat-cod" }, botaoCodigoCatalogo(l.codigo)),
    el("td", { className: "cat-txt" }, el("span", { textContent: l.texto || "" }),
      l.usar_no_lugar ? el("small", { className: "cat-usar" }, "texto manda usar o ", botaoCodigoCatalogo(l.usar_no_lugar)) : null,
      l.prefixo_indica ? el("small", { className: "cat-usar" }, `o prefixo indica ${l.prefixo_indica}`) : null),
    el("td", { className: "cat-tipo" }, l.tipo || ""),
    el("td", { className: "cat-gm", title: l.gm_nome || "" }, l.gm || "", l.gm_nome ? el("small", { textContent: l.gm_nome }) : null),
    el("td", {}, seloSituacao(l.bloqueio)),
    el("td", { className: "cat-acao" }, el("button", { type: "button", className: "sugestao", textContent: "Perguntar à Bella",
      title: `Perguntar à Bella sobre o ${l.codigo}`, onclick: () => perguntarSobre(l.codigo) }))));
  const tabela = el("div", { className: "cat-tabela" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Código", "Texto", "Tipo", "Grupo", "Situação", ""].map((t) => el("th", { textContent: t })))),
    el("tbody", {}, ...linhas)));
  const ir = (p) => { cat.pagina = p; buscarNoCatalogo(); $("cat-corpo").scrollTo({ top: 0 }); };
  const paginacao = paginas > 1 ? el("div", { className: "cat-paginas" },
    el("button", { type: "button", className: "sugestao", textContent: "← Anterior", disabled: d.pagina <= 1, onclick: () => ir(d.pagina - 1) }),
    el("span", { textContent: `Página ${d.pagina} de ${numeroBr(paginas)}` }),
    el("button", { type: "button", className: "sugestao", textContent: "Próxima →", disabled: d.pagina >= paginas, onclick: () => ir(d.pagina + 1) }))
    : null;
  // replaceChildren escreveria "null": so o que existe
  $("cat-corpo").replaceChildren(...[resumo, tabela, paginacao,
    d.total > d.por_pagina * maxPaginas ? el("p", { className: "cat-data", textContent: `Mostrando até ${maxPaginas} páginas: use mais palavras ou filtros para refinar.` }) : null,
    dataDosMateriais()].filter(Boolean));
}

// "Copiar link": o endereco desta busca, para colar no Teams (quem abrir ve o mesmo resultado)
function botaoLinkDaBusca() {
  const b = el("button", { type: "button", className: "sugestao", textContent: "🔗 Copiar link",
    title: "Copiar o link desta busca para mandar no Teams" });
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + location.pathname + linkDaBusca(filtrosDoCatalogo()));
      b.textContent = "✓ Link copiado";
    } catch (e) {
      b.textContent = "Não consegui copiar";
    }
    setTimeout(() => { b.textContent = "🔗 Copiar link"; }, 1800);
  };
  return b;
}

// no catalogo o codigo copia (o clique no texto pergunta a Bella, como na conversa)
function botaoCodigoCatalogo(c) {
  return el("span", { className: "ref-codigo" },
    el("button", { type: "button", className: "ref", textContent: c, title: `Perguntar à Bella sobre o ${c}`, onclick: () => perguntarSobre(c) }),
    botaoCopiar(c, `Copiar o código ${c}`, "copiar"));
}

function limparFiltrosDoCatalogo() {
  $("cat-tipo").value = "";
  $("cat-gm").value = "";
  $("cat-usar").checked = false;
  $("cat-errado").checked = false;
  cat.bloqueio = "";
  cat.pagina = 1;
  buscarNoCatalogo();
}

// ------------------------------------------------------------ painel (a primeira tela depois de entrar)
// Os indicadores da fila do Webformat e das bases (?painel=1, sem IA: nao gasta credito). Os numeros
// sao os mesmos do bom dia da Bella; o clique num indicador pergunta a lista a Bella (uma pergunta).
// Abre sozinho ao entrar com a conversa vazia; depois, pelo menu. Duas abas: "Visão geral" (#painel) e
// "Minhas pendências" (#pendencias: o que espera a pessoa no Webformat, pelo nome dela la).

// vista: "" (o painel) ou "aberto" (a tela "Em aberto", aberta pelo cartão; #em-aberto)
const pn = { aberto: false, dados: null, em: 0, carregando: false, erro: "", visto: false, aba: "fila", trocarNome: false, vista: "" };
const LINKS_DO_PAINEL = { "#painel": "fila", "#pendencias": "pendencias", "#em-aberto": "aberto" };
const PAINEL_VELHO_MS = 60000;
const SVG = "http://www.w3.org/2000/svg";
const mil = (n) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "–");
const ddmmDe = (dia) => String(dia || "").slice(5, 10).split("-").reverse().join("/");

// qual: "fila" | "pendencias" | "aberto" (sem dizer, a aba que estava)
function abrirPainel(qual) {
  fecharLado();
  fecharCatalogo();
  if (qual === "fila" || qual === "pendencias") { pn.aba = qual; pn.vista = ""; }
  if (qual === "aberto") { pn.aba = "fila"; pn.vista = "aberto"; }
  pn.aberto = true;
  pn.visto = true;
  $("chat").classList.add("modo-painel");
  $("painel").hidden = false;
  $("atalho-painel").setAttribute("aria-current", "true");
  marcarEndereco(pn.vista === "aberto" ? "#em-aberto" : pn.aba === "pendencias" ? "#pendencias" : "#painel");
  desenharConversas();
  desenharTitulo();
  if (!pn.dados || Date.now() - pn.em > PAINEL_VELHO_MS) carregarPainel(); else desenharPainel();
  if (pn.vista === "aberto") abrirEmAberto();
}

function fecharPainel() {
  if (!pn.aberto) return;
  pn.aberto = false;
  $("chat").classList.remove("modo-painel");
  $("painel").hidden = true;
  $("atalho-painel").removeAttribute("aria-current");
  if (LINKS_DO_PAINEL[location.hash]) marcarEndereco("");
  desenharConversas();
  desenharTitulo();
}

async function carregarPainel() {
  if (pn.carregando) return;
  pn.carregando = true;
  $("pn-corpo").classList.add("carregando");
  if (!pn.dados) $("pn-corpo").replaceChildren(el("p", { className: "pn-msg", textContent: "Contando a fila…" }));
  try {
    pn.dados = await chamar({ painel: 1 });
    pn.em = Date.now();
    pn.erro = "";
  } catch (e) {
    pn.erro = e instanceof ErroConsulta ? e.message : "erro inesperado";
  } finally {
    pn.carregando = false;
    $("pn-corpo").classList.remove("carregando");
  }
  if (pn.aberto && codigo && pn.vista !== "aberto") desenharPainel();
}

// o clique num indicador: a Bella lista na conversa
function perguntarDoPainel(q) {
  fecharPainel();
  enviar(q);
}

// "hoje às 08:32", "ontem às 17:10", "em 27/10 às 09:00"
function quando(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dia = (x) => x.toLocaleDateString("pt-BR");
  const ontem = new Date(Date.now() - 864e5);
  return dia(d) === dia(new Date()) ? `hoje às ${hora}` : dia(d) === dia(ontem) ? `ontem às ${hora}`
    : `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}

// Tendencia: as fotos da manha de cada dia util e, no fim, o numero de agora.
// Linha fina no tom apagado e o ponto de agora em destaque; cada ponto tem a dica (title) com o dia.
function sparkline(pontos, rotulo) {
  const W = 132, H = 36, P = 5;
  const vs = pontos.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const x = (i) => P + (pontos.length === 1 ? (W - 2 * P) : (i * (W - 2 * P)) / (pontos.length - 1));
  const y = (v) => (max === min ? H / 2 : H - P - ((v - min) * (H - 2 * P)) / (max - min));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("class", "pn-tendencia");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${rotulo}: de ${mil(pontos[0].v)} em ${pontos[0].rotulo} para ${mil(vs[vs.length - 1])} agora`);
  const linha = document.createElementNS(SVG, "polyline");
  linha.setAttribute("points", pontos.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" "));
  linha.setAttribute("class", "pn-linha");
  svg.append(linha);
  const fim = document.createElementNS(SVG, "circle");
  fim.setAttribute("cx", x(pontos.length - 1).toFixed(1));
  fim.setAttribute("cy", y(vs[vs.length - 1]).toFixed(1));
  fim.setAttribute("r", "4");
  fim.setAttribute("class", "pn-agora");
  svg.append(fim);
  // faixas invisiveis para a dica de cada ponto (alvo maior que o ponto)
  const passo = pontos.length > 1 ? (W - 2 * P) / (pontos.length - 1) : W;
  pontos.forEach((p, i) => {
    const r = document.createElementNS(SVG, "rect");
    r.setAttribute("x", Math.max(0, x(i) - passo / 2).toFixed(1));
    r.setAttribute("y", "0");
    r.setAttribute("width", passo.toFixed(1));
    r.setAttribute("height", H);
    r.setAttribute("class", "pn-alvo");
    const t = document.createElementNS(SVG, "title");
    t.textContent = `${p.rotulo}: ${mil(p.v)}`;
    r.append(t);
    svg.append(r);
  });
  return svg;
}

// serie de uma chave das fotos + o valor de agora; e a variacao desde a foto de uma semana atras
function serieDe(chave, agora) {
  const fotos = (pn.dados.evolucao || []).filter((f) => typeof f[chave] === "number");
  const pontos = fotos.map((f) => ({ v: f[chave], rotulo: ddmmDe(f.dia), dia: f.dia }));
  if (typeof agora === "number") pontos.push({ v: agora, rotulo: "agora", dia: "" });
  const semana = new Date(Date.now() - 7 * 864e5).toLocaleDateString("sv-SE");
  const base = [...fotos].reverse().find((f) => f.dia <= semana) || fotos[0];
  return {
    pontos: pontos.length >= 3 ? pontos : null,
    variacao: base && typeof agora === "number" ? { n: agora - base[chave], desde: ddmmDe(base.dia) } : null,
  };
}

// fila: subir e pior (vermelho com ▲), descer e melhor (verde com ▼); a seta e o texto dizem, a cor reforca
function variacao(v) {
  if (!v) return null;
  if (v.n === 0) return el("span", { className: "pn-var igual", textContent: `= igual a ${v.desde}` });
  return el("span", { className: `pn-var ${v.n > 0 ? "pior" : "melhor"}`,
    textContent: `${v.n > 0 ? "▲" : "▼"} ${mil(Math.abs(v.n))} desde ${v.desde}` });
}

// abrir: o clique abre uma tela (o "Em aberto"); pergunta: o clique pergunta a lista a Bella
// dica: o que o número é, em português simples (aparece ao passar o mouse, antes do que o clique faz)
function cartaoIndicador({ rotulo, valor, sub, chave, pergunta, alerta, abrir, dica }) {
  const s = chave ? serieDe(chave, valor) : { pontos: null, variacao: null };
  const corpo = [
    el("span", { className: "pn-rotulo", textContent: rotulo }),
    el("strong", { className: "pn-valor", textContent: mil(valor) }),
    sub ? el("span", { className: "pn-sub" + (alerta ? " alerta" : ""), textContent: sub }) : null,
    s.pontos || s.variacao ? el("span", { className: "pn-rodape" }, variacao(s.variacao), s.pontos ? sparkline(s.pontos, rotulo) : null) : null,
  ];
  const antes = dica ? `${dica}\n\n` : "";
  if (abrir) return el("button", { type: "button", className: "pn-cartao", title: `${antes}Clique para abrir os detalhes`, onclick: abrir }, ...corpo);
  return pergunta
    ? el("button", { type: "button", className: "pn-cartao", title: `${antes}Clique para ver a lista com a Bella: “${pergunta}”`,
      onclick: () => perguntarDoPainel(pergunta) }, ...corpo)
    : el("div", { className: "pn-cartao", title: dica || "" }, ...corpo);
}

function secao(titulo, sub, ...filhos) {
  return el("section", { className: "pn-secao" },
    el("div", { className: "pn-secao-topo" }, el("h3", { textContent: titulo }), sub ? el("small", { textContent: sub }) : null),
    ...filhos);
}

// com quem estao as abertas: barras horizontais de uma cor so, valor na ponta
// aoClicar: o que o clique numa barra faz com a pergunta dela (no painel, a Bella lista na conversa)
function barrasComQuem(itens, total, aoClicar = perguntarDoPainel) {
  const maior = Math.max(1, ...itens.map((d) => d.n));
  return el("div", { className: "pn-barras" }, ...itens.map((d) => {
    const barra = el("span", { className: "pn-barra" });
    barra.style.width = `${Math.max((d.n / maior) * 100, 0.6)}%`;
    const pct = total ? Math.round((d.n / total) * 100) : 0;
    const corpo = [
      el("span", { className: "pn-b-rotulo", textContent: d.rotulo }),
      el("span", { className: "pn-b-trilho" }, barra),
      el("span", { className: "pn-b-valor" }, mil(d.n), el("small", { textContent: pct || !d.n ? ` ${pct}%` : " <1%" })),
    ];
    return d.pergunta
      ? el("button", { type: "button", className: "pn-b-linha", title: `${mil(d.n)} de ${mil(total)} (${pct}%) · ver a lista com a Bella`,
        onclick: () => aoClicar(d.pergunta) }, ...corpo)
      : el("div", { className: "pn-b-linha", title: `${mil(d.n)} de ${mil(total)} (${pct}%)` }, ...corpo);
  }));
}

// como terminaram as da semana: barra empilhada (verde, vermelho, cinza) com legenda e numeros
function barraTerminadas(s) {
  const partes = [["encerradas", "Encerradas", s.encerradas], ["reprovadas", "Reprovadas", s.reprovadas],
    ["canceladas", "Canceladas", s.canceladas]].filter((p) => p[2] > 0);
  const total = partes.reduce((a, p) => a + p[2], 0);
  if (!total) return null;
  const pilha = el("div", { className: "pn-pilha", role: "img",
    ariaLabel: partes.map((p) => `${p[1]}: ${mil(p[2])}`).join(", ") });
  for (const [cls, nome, n] of partes) {
    const seg = el("span", { className: `pn-seg ${cls}`, title: `${nome}: ${mil(n)} (${Math.round((n / total) * 100)}%)` });
    seg.style.flexGrow = String(n);
    pilha.append(seg);
  }
  return el("div", { className: "pn-terminadas" }, pilha,
    el("ul", { className: "pn-legenda" }, ...partes.map(([cls, nome, n]) =>
      el("li", {}, el("i", { className: `pn-seg ${cls}`, ariaHidden: "true" }), `${nome} `, el("b", { textContent: mil(n) })))));
}

function numeroDaSemana(rotulo, valor, sub) {
  return el("div", { className: "pn-num" }, el("span", { className: "pn-rotulo", textContent: rotulo }),
    el("strong", { textContent: valor }), sub ? el("small", { textContent: sub }) : null);
}

function linhaDaBase(ok, nomeBase, texto, aviso) {
  return el("li", {}, el("i", { className: `ponto ${ok ? "verde" : "amarelo"}`, ariaHidden: "true" }),
    el("b", { textContent: nomeBase }), ` ${texto}`, aviso ? el("small", { textContent: ` · ⚠️ ${aviso}` }) : null);
}

function trocarAbaDoPainel(qual) {
  pn.aba = qual;
  pn.vista = "";
  pn.trocarNome = false;
  marcarEndereco(qual === "pendencias" ? "#pendencias" : "#painel");
  desenharPainel();
  const ativa = document.querySelector(".pn-aba[aria-selected=\"true\"]");
  if (ativa) ativa.focus();
}

// ---- aba "Minhas pendências"

// "devolvida hoje", "há 1 dia com você", "há 15 dias com você"
const diasComVoce = (d) => (d === null || d === undefined ? "" : d === 0 ? "devolvida hoje" : `há ${mil(d)} ${d === 1 ? "dia" : "dias"} com você`);
const DIAS_CANCELAMENTO = 14;   // regra de negocio (guia da Bella): 2 semanas sem tratamento geram pedido de cancelamento

function cartaoPendencia(p) {
  const velha = typeof p.dias === "number" && p.dias >= DIAS_CANCELAMENTO;
  return el("article", { className: "pn-pend" + (velha ? " velha" : "") },
    el("div", { className: "pn-pend-cab" },
      botaoSolicitacao(p.numero),
      el("span", { className: `pn-selo ${p.tecnica ? "tecnica" : "md"}`, textContent: p.tecnica ? "Pendência técnica (CH)" : "Devolvida pelo Master Data" }),
      el("span", { className: "pn-dias" + (velha ? " alerta" : ""), textContent: diasComVoce(p.dias),
        title: velha ? "Pela regra, 2 semanas sem resposta geram pedido de cancelamento" : "" })),
    el("p", { className: "pn-pend-desc", textContent: [p.tipo, p.descricao].filter(Boolean).join(" · ") }),
    p.pedido ? el("details", { className: "pn-pedido" },
      el("summary", { textContent: p.tecnica ? "O que a CH pediu" : "O que pediram" }), el("p", { textContent: p.pedido })) : null,
    el("div", { className: "pn-pend-acoes" },
      el("button", { type: "button", className: "sugestao", textContent: "💬 Me ajuda a responder",
        onclick: () => perguntarDoPainel(p.tecnica ? `o que a CH quer na ${p.numero}?` : `o que o Master Data pediu na ${p.numero}?`) })));
}

async function vincularNome(nomeWf, aviso) {
  aviso.textContent = "Guardando…";
  try {
    const r = await chamar({ painel: 1 }, { acao: "vincular", solicitante: nomeWf });
    pn.dados.minhas = r.minhas || null;
    pn.trocarNome = false;
    desenharPainel();
  } catch (e) {
    aviso.textContent = `Não consegui guardar (${e instanceof ErroConsulta ? e.message : "erro inesperado"}).`;
  }
}

// "Como o seu nome aparece no Webformat?": sugestoes pelo nome do login e busca pelo nome digitado
function formNome(sugestoes) {
  const aviso = el("p", { className: "pn-aviso-nome", role: "status" });
  const lista = el("div", { className: "pn-sugs-nome" });
  const mostrar = (ss) => lista.replaceChildren(...ss.map((s) => el("button", { type: "button", className: "sugestao",
    onclick: () => vincularNome(s.nome, aviso) }, s.nome,
  el("small", { textContent: ` · ${mil(s.solicitacoes)} ${s.solicitacoes === 1 ? "solicitação" : "solicitações"}` }))));
  const campo = el("input", { type: "search", maxLength: 120, autocomplete: "off", spellcheck: false,
    placeholder: "Seu nome ou sobrenome, como no Webformat", ariaLabel: "Seu nome no Webformat" });
  const form = el("form", { className: "pn-busca-nome" }, campo, el("button", { type: "submit", className: "sugestao", textContent: "Procurar" }));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    aviso.textContent = "Procurando…";
    try {
      const r = await chamar({ painel: 1 }, { acao: "procurar", nome: campo.value });
      const ss = Array.isArray(r.sugestoes) ? r.sugestoes : [];
      mostrar(ss);
      aviso.textContent = !ss.length ? "Não achei esse nome entre os solicitantes. Tente só o sobrenome."
        : r.aproximado ? "Não achei igual; estes são parecidos. É algum deles?" : "É algum destes?";
    } catch (e) {
      aviso.textContent = e instanceof ErroConsulta ? `${e.message[0].toUpperCase()}${e.message.slice(1)}.` : "Não consegui procurar agora.";
    }
  });
  mostrar(sugestoes);
  if (sugestoes.length) aviso.textContent = "Achei pelo seu nome de login. É algum destes?";
  return el("section", { className: "pn-secao pn-nome" },
    el("h3", { textContent: "Como o seu nome aparece no Webformat?" }),
    el("p", { className: "pn-nota", textContent: "É só uma vez: com ele eu mostro aqui as suas pendências e respondo “como estão as minhas?”." }),
    aviso, lista, form);
}

function abaPendencias(d) {
  const m = d.minhas;
  if (!m) {
    return [el("section", { className: "pn-secao pn-vazio" }, el("p", { textContent: "As pendências são pessoais: entre com a sua chave pessoal " +
      "ou com a conta Microsoft para ver as que estão esperando você." }))];
  }
  if (!m.solicitante || pn.trocarNome) return [formNome(m.solicitante ? [] : m.sugestoes || [])];
  const ps = m.pendencias || [];
  const cab = el("div", { className: "pn-pend-topo" },
    el("p", {}, el("strong", { textContent: m.com_voce ? `${mil(m.com_voce)} ${m.com_voce === 1 ? "solicitação está" : "solicitações estão"} esperando você`
      : "Nenhuma pendência esperando você 🎉" }),
    el("small", { textContent: ` · ${mil(m.abertas)} ${m.abertas === 1 ? "aberta" : "abertas"} no Webformat como ${m.solicitante}` })),
    el("button", { type: "button", className: "link", textContent: "Não é você? Trocar o nome",
      onclick: () => { pn.trocarNome = true; desenharPainel(); } }));
  const nos = [cab];
  if (ps.length) {
    nos.push(el("p", { className: "pn-nota", textContent: "Responda no próprio Webformat, na solicitação. A mais antiga vem primeiro." }),
      el("div", { className: "pn-pends" }, ...ps.map(cartaoPendencia)));
    if (m.com_voce > ps.length) nos.push(el("p", { className: "pn-nota", textContent: `Mostrando as ${mil(ps.length)} mais antigas.` }));
  }
  return nos;
}

function desenharPainel() {
  if (pn.vista === "aberto" && pn.aba !== "pendencias") { desenharEmAberto(); return; }
  const d = pn.dados;
  const naFila = pn.aba !== "pendencias";
  const topo = el("div", { className: "pn-topo" },
    el("div", {}, el("h2", { textContent: `${saudacao()}${nome && !esperandoNome ? `, ${nome}` : ""}! ` +
      (naFila ? "Assim está a fila" : "Suas pendências") }),
    el("p", { textContent: naFila ? "Clique num número para a Bella mostrar a lista." : "O que está esperando a sua resposta no Webformat." })),
    el("button", { type: "button", className: "sugestao", textContent: pn.carregando ? "Atualizando…" : "↻ Atualizar",
      disabled: pn.carregando, onclick: carregarPainel }));
  const n = d && d.minhas && d.minhas.solicitante ? d.minhas.com_voce : 0;
  const botaoAba = (id, rotulo, extra) => el("button", { type: "button", role: "tab", className: "pn-aba", id: `pn-aba-${id}`,
    ariaSelected: String(pn.aba === id), tabIndex: pn.aba === id ? 0 : -1, onclick: () => trocarAbaDoPainel(id) }, rotulo, extra);
  const abas = el("div", { className: "pn-abas", role: "tablist", ariaLabel: "Painel" },
    botaoAba("fila", "Visão geral"),
    botaoAba("pendencias", "Minhas pendências", n ? el("b", { className: "pn-badge", textContent: mil(n), ariaLabel: `${n} esperando você` }) : null));
  // setas trocam de aba (padrao de abas)
  abas.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") { ev.preventDefault(); trocarAbaDoPainel(naFila ? "pendencias" : "fila"); }
  });
  if (!d) {
    $("pn-corpo").replaceChildren(topo, abas, el("div", { className: "pn-erro", role: "alert" },
      el("p", { textContent: `Não consegui carregar o painel (${pn.erro || "erro inesperado"}).` }),
      el("button", { type: "button", className: "sugestao", textContent: "Tentar de novo", onclick: carregarPainel })));
    return;
  }
  const a = d.agora || {}, s = d.semana || {}, b = d.bases || {};
  const nos = [topo, abas];
  if (pn.erro) nos.push(el("p", { className: "pn-erro", role: "alert", textContent: `Não consegui atualizar agora (${pn.erro}): números de ${quando(new Date(pn.em).toISOString())}.` }));
  if (!naFila) {
    const painelAba = el("div", { className: "pn-conteudo", role: "tabpanel" }, ...abaPendencias(d));
    painelAba.setAttribute("aria-labelledby", "pn-aba-pendencias");
    $("pn-corpo").replaceChildren(...nos, painelAba);
    return;
  }

  nos.push(el("div", { className: "pn-cartoes" },
    cartaoIndicador({ rotulo: "Em aberto", valor: a.abertas, chave: "em_aberto", abrir: abrirEmAberto,
      dica: "Solicitações que ainda não terminaram no Webformat (nem encerradas, nem reprovadas, nem canceladas). A seta compara com a manhã anterior.",
      sub: `${mil(a.novas)} ${a.novas === 1 ? "nova" : "novas"} desde ${a.desde}` + (a.novas ? ` (${mil(a.novas_urgentes)} ${a.novas_urgentes === 1 ? "urgente" : "urgentes"})` : "") }),
    cartaoIndicador({ rotulo: "Com a CH", valor: a.com_a_ch, chave: "com_a_ch", pergunta: "quais estão com a CH há mais de 48 horas úteis?",
      dica: "Com a CH (a consultoria de cadastro) agora. O prazo dela é de 24 a 48 h úteis; o número de baixo são as que já passaram de 48 h, somando todas as passagens.",
      sub: `${mil(a.ch_48h)} acima de 48 h úteis (somando as passagens)`, alerta: a.ch_48h > 0 }),
    cartaoIndicador({ rotulo: "Pendência técnica", valor: a.pendencia_tecnica, chave: "pendencia_tecnica",
      dica: "A CH devolveu ao solicitante pedindo informação; a solicitação só anda quando ele responde no Webformat.",
      pergunta: "quais estão em pendência técnica?",
      sub: a.pendencia_mais_antiga ? `a mais antiga: ${a.pendencia_mais_antiga.numero} (${mil(a.pendencia_mais_antiga.dias)} dias)` : "" }),
    cartaoIndicador({ rotulo: `Terminadas desde ${a.desde}`, valor: a.terminadas, pergunta: `quais terminaram desde ${a.desde}?`,
      dica: "As que saíram da fila desde o último dia útil: cadastradas (encerradas), reprovadas ou canceladas.",
      sub: "encerradas, reprovadas ou canceladas" })));

  if (d.minhas && d.minhas.solicitante) {
    nos.push(el("button", { type: "button", className: "pn-minhas", onclick: () => trocarAbaDoPainel("pendencias") },
      el("span", { className: "ic c-amarelo", ariaHidden: "true", textContent: "▤" }),
      el("span", {}, el("b", { textContent: "Suas solicitações: " }),
        `${mil(d.minhas.abertas)} ${d.minhas.abertas === 1 ? "aberta" : "abertas"}`,
        d.minhas.com_voce ? el("strong", { className: "pn-com-voce", textContent: ` · ${mil(d.minhas.com_voce)} esperando você (pendência)` }) : null),
      el("span", { className: "pn-ir", ariaHidden: "true", textContent: "→" })));
  }

  const grade = el("div", { className: "pn-grade" });
  if ((d.com_quem || []).length) {
    grade.append(secao(`Com quem estão as ${mil(a.abertas)} abertas`, "agora",
      el("p", { className: "ea-explica", textContent: "Em que etapa cada aberta está parada agora. Cada uma conta uma vez só: " +
        "a soma das barras dá o total em aberto. Clique numa barra para ver a lista." }),
      barrasComQuem(d.com_quem, a.abertas)));
  }
  const taxa = s.terminadas ? Math.round((100 * s.reprovadas) / s.terminadas) : null;
  grade.append(secao("Esta semana", `desde segunda, ${s.desde}`,
    el("p", { className: "ea-explica", textContent: "O que entrou e o que saiu da fila desde segunda. Reprovação é a parte " +
      "das terminadas que foi reprovada; tempo médio é da abertura até terminar, em dias corridos." }),
    el("div", { className: "pn-nums" },
      numeroDaSemana("Novas", mil(s.novas), s.novas ? `${mil(s.novas_urgentes)} ${s.novas_urgentes === 1 ? "urgente" : "urgentes"}` : ""),
      numeroDaSemana("Terminadas", mil(s.terminadas), ""),
      numeroDaSemana("Reprovação", taxa === null ? "–" : `${taxa}%`, "das terminadas"),
      numeroDaSemana("Tempo médio", s.tempo_medio_dias === null || s.tempo_medio_dias === undefined ? "–" : `${mil(s.tempo_medio_dias)} ${s.tempo_medio_dias === 1 ? "dia" : "dias"}`,
        "da abertura ao fim")),
    barraTerminadas(s),
    s.trocadas ? el("p", { className: "pn-nota", textContent: `${mil(s.trocadas)} ${s.trocadas === 1 ? "foi aberta" : "foram abertas"} com um tipo e ` +
      `${s.trocadas === 1 ? "cadastrada" : "cadastradas"} com outro` + (s.troca_comum ? ` (mais comum: ${s.troca_comum.par}, ${mil(s.troca_comum.n)})` : "") + "." }) : null));
  nos.push(grade);

  const velho = b.webformat_em && Date.now() - new Date(b.webformat_em).getTime() > 3 * 3600e3;
  // conferencia diaria do leitor (Relatorio Gerencial x banco); diferenca vai para o Luiz no Teams
  const conf = b.conferido;
  nos.push(el("ul", { className: "pn-bases" },
    b.webformat_em ? linhaDaBase(!velho, "Webformat", `atualizado ${quando(b.webformat_em)}`, velho ? "pode estar desatualizado" : "") : null,
    conf ? linhaDaBase(!conf.diferencas, "Conferência", `com o Webformat ${quando(conf.em)}${conf.diferencas ? "" : " ✓"}`,
      conf.diferencas ? `${conf.diferencas} ${conf.diferencas === 1 ? "diferença" : "diferenças"}, o time já foi avisado` : "") : null,
    b.sap_de ? linhaDaBase(!b.sap_antigo, "SAP", `${mil(b.sap_materiais)} materiais · carga de ${b.sap_de}`, b.sap_antigo || "") : null));
  const inicio = (d.evolucao || [])[0];
  nos.push(el("p", { className: "pn-nota fim", textContent: "Os mesmos números do Relatório Gerencial do Webformat e do bom dia da Bella no Teams." +
    (inicio ? ` As linhas mostram a fila na manhã de cada dia útil desde ${ddmmDe(inicio.dia)}.` : "") }));
  $("pn-corpo").replaceChildren(...nos);
}

// ------------------------------------------------------------ tela "Em aberto" (o clique no cartão "Em aberto")
// As abertas vistas de vários jeitos (?painel=1&detalhe=aberto, sem IA). Cada caixa explica o que mostra; o
// clique numa barra leva a lista para a conversa principal, com o mesmo número da barra.

const ea = { dados: null, em: 0, carregando: false, erro: "" };

function abrirEmAberto() {
  pn.vista = "aberto";
  marcarEndereco("#em-aberto");
  if (!ea.dados || Date.now() - ea.em > PAINEL_VELHO_MS) carregarEmAberto(); else desenharEmAberto();
  $("painel").scrollTop = 0;
}

function voltarDoEmAberto() {
  pn.vista = "";
  marcarEndereco("#painel");
  desenharPainel();
}

async function carregarEmAberto() {
  if (ea.carregando) return;
  ea.carregando = true;
  desenharEmAberto();
  try {
    ea.dados = await chamar({ painel: 1, detalhe: "aberto" });
    ea.em = Date.now();
    ea.erro = "";
  } catch (e) {
    ea.erro = e instanceof ErroConsulta ? e.message : "erro inesperado";
  } finally {
    ea.carregando = false;
  }
  if (pn.aberto && pn.vista === "aberto") desenharEmAberto();
}

// faixas de tempo em colunas de uma cor; a faixa fora do prazo em laranja, com o ⚠ no rótulo (cor não fica sozinha)
function colunas(itens = [], aoClicar) {
  const maior = Math.max(1, ...itens.map((d) => d.n));
  const total = itens.reduce((s, d) => s + d.n, 0);
  return el("div", { className: "ea-colunas" }, ...itens.map((d) => {
    const barra = el("span", { className: "ea-coluna" + (d.alerta ? " alerta" : "") });
    barra.style.height = `${d.n ? Math.max((d.n / maior) * 100, 3) : 0}%`;
    const pct = total ? Math.round((d.n / total) * 100) : 0;
    return el("button", { type: "button", className: "ea-col", title: `${d.rotulo}: ${mil(d.n)} (${pct}%) · perguntar a lista`,
      onclick: () => aoClicar(d.pergunta) },
      el("span", { className: "ea-col-valor" }, mil(d.n), el("small", { textContent: ` ${pct}%` })),
      el("span", { className: "ea-col-trilho" }, barra),
      el("span", { className: "ea-col-rotulo", textContent: (d.alerta ? "⚠ " : "") + d.rotulo }));
  }));
}

// a fila na manhã de cada dia útil (as fotos do painel): em aberto em linha cheia, pendência técnica tracejada.
// No fim, o ponto "agora" (o número da tela neste momento), em anel e ligado por pontilhado: não é foto da manhã.
function linhaDaFila(evolucao, agora, lidoEm) {
  const manhas = (evolucao || []).filter((f) => typeof f.em_aberto === "number");
  if (manhas.length < 2) return el("p", { className: "pn-nota", textContent: "Ainda poucos dias de histórico para desenhar a linha." });
  const hora = lidoEm ? new Date(lidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const temAgora = agora && typeof agora.abertas === "number";
  const fotos = temAgora ? [...manhas, { dia: "", agora: true, em_aberto: agora.abertas,
    pendencia_tecnica: typeof agora.pendencia_tecnica === "number" ? agora.pendencia_tecnica : null }] : manhas;
  const rotuloDe = (f) => f.agora ? "agora" : ddmmDe(f.dia);
  const series = [["em_aberto", "Em aberto", "ea-l1"], ["pendencia_tecnica", "Pendência técnica", "ea-l2"]];
  const W = 640, H = 190, E = 44, D = 12, T = 10, B = 26;
  const vs = fotos.flatMap((f) => series.map(([k]) => f[k]).filter((v) => typeof v === "number"));
  const max = Math.ceil(Math.max(...vs) / 100) * 100, min = 0;
  const x = (i) => E + (i * (W - E - D)) / (fotos.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "ea-grafico");
  svg.setAttribute("role", "img");
  const ult = fotos[fotos.length - 1];
  svg.setAttribute("aria-label", `Em aberto de ${mil(fotos[0].em_aberto)} em ${ddmmDe(fotos[0].dia)} para ${mil(ult.em_aberto)} ${ult.agora ? "agora" : "em " + ddmmDe(ult.dia)}; ` +
    `pendência técnica de ${mil(fotos[0].pendencia_tecnica)} para ${mil(ult.pendencia_tecnica)}`);
  const no = (tag, attrs, texto) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (texto !== undefined) n.textContent = texto;
    svg.append(n);
    return n;
  };
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    no("line", { x1: E, x2: W - D, y1: y(v), y2: y(v), class: i ? "ea-grade-l" : "ea-base" });
    no("text", { x: E - 6, y: y(v) + 4, class: "ea-eixo", "text-anchor": "end" }, mil(Math.round(v)));
  }
  const passo = Math.ceil(fotos.length / 8);
  fotos.forEach((f, i) => {
    const ponta = i === 0 ? "start" : i === fotos.length - 1 ? "end" : "middle";
    // o rótulo da última manhã sai quando o "agora" fica colado nele
    const colado = temAgora && i === fotos.length - 2 && passo > 1;
    if ((i % passo === 0 && !colado) || i === fotos.length - 1) no("text", { x: x(i), y: H - 8, class: `ea-eixo${f.agora ? " ea-eixo-agora" : ""}`, "text-anchor": ponta }, rotuloDe(f));
  });
  const nManhas = manhas.length;
  for (const [k, , cls] of series) {
    const pts = manhas.map((f, i) => typeof f[k] === "number" ? `${x(i).toFixed(1)},${y(f[k]).toFixed(1)}` : null).filter(Boolean);
    no("polyline", { points: pts.join(" "), class: `ea-l ${cls}` });
    const i = nManhas - 1;
    const a = fotos[nManhas];
    if (a && typeof a[k] === "number" && typeof fotos[i][k] === "number") {
      no("line", { x1: x(i), y1: y(fotos[i][k]), x2: x(nManhas), y2: y(a[k]), class: `ea-l-agora ${cls}` });
      no("circle", { cx: x(i), cy: y(fotos[i][k]), r: 3, class: `ea-ponto ${cls}` });
      no("circle", { cx: x(nManhas), cy: y(a[k]), r: 4.5, class: `ea-ponto-agora ${cls}` });
    } else if (typeof fotos[i][k] === "number") no("circle", { cx: x(i), cy: y(fotos[i][k]), r: 4, class: `ea-ponto ${cls}` });
  }
  // dica de cada dia (alvo maior que o ponto)
  const larg = (W - E - D) / (fotos.length - 1);
  fotos.forEach((f, i) => {
    const r = no("rect", { x: Math.max(0, x(i) - larg / 2), y: 0, width: larg, height: H - B, class: "pn-alvo" });
    const t = document.createElementNS(SVG, "title");
    t.textContent = `${f.agora ? `Agora${hora ? ` (Webformat lido às ${hora})` : ""}` : `${ddmmDe(f.dia)}, de manhã`}: ` +
      `${mil(f.em_aberto)} em aberto · ${mil(f.pendencia_tecnica)} em pendência técnica`;
    r.append(t);
  });
  return el("div", {},
    el("ul", { className: "pn-legenda ea-legenda" },
      el("li", {}, el("i", { className: "ea-chave ea-l1", ariaHidden: "true" }), "Em aberto (linha cheia)"),
      el("li", {}, el("i", { className: "ea-chave ea-l2", ariaHidden: "true" }), "Pendência técnica (tracejada)"),
      temAgora ? el("li", {}, el("i", { className: "ea-chave-agora", ariaHidden: "true" }), `Agora${hora ? `, ${hora}` : ""} (o número da tela; os outros pontos são a manhã de cada dia)`) : null),
    svg);
}

// Caixa da tela "Em aberto": título, subtítulo e o gráfico. Sem pergunta dentro da caixa (pedido do Luiz em
// 30/10/2026): o clique numa barra leva a lista para a conversa, com o mesmo número da barra.
// Cada card diz, nesta ordem: o resumo (a leitura do número que importa, em uma frase), o que ele mostra e
// como ler (português simples) e o gráfico. Pedido do Luiz: "bem explicativo e intuitivo".
function caixaEa(titulo, sub, texto, grafico, largura) {
  const { resumo, explica } = texto || {};
  return el("section", { className: "pn-secao ea-caixa" + (largura ? " largo" : "") },
    el("div", { className: "pn-secao-topo" }, el("h3", { textContent: titulo }), sub ? el("small", { textContent: sub }) : null),
    resumo ? el("p", { className: "ea-resumo" }, el("span", { className: "ea-resumo-ic", ariaHidden: "true", textContent: "💡" }), resumo) : null,
    explica ? el("details", { className: "ea-como", open: true }, el("summary", { textContent: "O que é e como ler" }),
      el("p", { className: "ea-explica", textContent: explica })) : null,
    grafico(perguntarDoPainel));
}

// Quem mais pede certo: a taxa de solicitações cadastradas sem nenhuma pendência técnica, por solicitante.
// Sem clique (a lista do clique não daria o mesmo número); a dica conta o que entra na conta.
function barrasAcerto(itens = []) {
  return el("div", { className: "pn-barras" }, ...itens.map((d) => {
    const barra = el("span", { className: "pn-barra ea-acerto" });
    barra.style.width = `${Math.max(d.taxa, 0.6)}%`;
    return el("div", { className: "pn-b-linha", title: `${d.rotulo}: ${mil(d.certos)} de ${mil(d.pedidos)} terminadas foram cadastradas ` +
      `sem nenhuma pendência técnica (${d.taxa}%)` },
      el("span", { className: "pn-b-rotulo", textContent: d.rotulo }),
      el("span", { className: "pn-b-trilho" }, barra),
      el("span", { className: "pn-b-valor" }, `${d.taxa}%`, el("small", { textContent: ` de ${mil(d.pedidos)}` })));
  }));
}

// De onde vêm os números: a leitura do Webformat e a última conferência com o Relatório Gerencial.
// Diferença aparece com o número de cada solicitação (para conferir no Webformat), nunca escondida.
function fonteDoEmAberto(f) {
  if (!f || (!f.lido_em && !f.conferido_em)) return [];
  const partes = [];
  if (f.lido_em) partes.push(`Webformat lido ${quando(f.lido_em)}.`);
  if (f.conferido_em && f.diferencas === 0) partes.push(`Conferido com o Relatório Gerencial ${quando(f.conferido_em)}: sem diferenças ✓`);
  // as que o leitor ja releu e agora batem com o Webformat saem do aviso
  const faltam = f.diferencas > 0 ? f.diferencas - (f.corrigidas || 0) : 0;
  if (f.conferido_em && f.diferencas > 0 && !faltam) {
    partes.push(`Conferência ${quando(f.conferido_em)}: ${f.diferencas === 1 ? "a diferença com o Relatório Gerencial já foi relida e corrigida"
      : `as ${mil(f.diferencas)} diferenças com o Relatório Gerencial já foram relidas e corrigidas`} ✓`);
  }
  const aviso = [];
  if (f.conferido_em && faltam > 0) {
    aviso.push(el("p", { className: "pn-nota ea-conferencia", role: "note" },
      el("strong", { textContent: `⚠ Conferência ${quando(f.conferido_em)}: ` }),
      `o Relatório Gerencial do Webformat tinha ${mil(f.webformat_em_aberto)} em aberto e aqui ${mil(f.aqui_na_conferencia)}. ` +
      `${mil(faltam)} ${faltam === 1 ? "solicitação ainda está diferente" : "solicitações ainda estão diferentes"}` +
      (f.numeros && f.numeros.length ? ` (${f.numeros.join(", ")})` : "") +
      (f.corrigidas ? `; ${mil(f.corrigidas)} já ${f.corrigidas === 1 ? "foi corrigida" : "foram corrigidas"}` : "") +
      ": o leitor relê e confere de novo."));
  }
  return [el("p", { className: "pn-nota", textContent: partes.join(" ") }), ...aviso];
}

function desenharEmAberto() {
  const d = ea.dados;
  const topo = el("div", { className: "pn-topo" },
    el("div", {},
      el("button", { type: "button", className: "link ea-voltar", textContent: "← Voltar ao painel", onclick: voltarDoEmAberto }),
      el("h2", { textContent: d ? `${mil(d.total)} solicitações em aberto` : "Em aberto" }),
      el("p", { textContent: "Clique numa barra: a Bella traz a lista na conversa, com o mesmo número." })),
    el("button", { type: "button", className: "sugestao", textContent: ea.carregando ? "Atualizando…" : "↻ Atualizar",
      disabled: ea.carregando, onclick: carregarEmAberto }));
  if (!d) {
    $("pn-corpo").replaceChildren(topo, ea.erro
      ? el("div", { className: "pn-erro", role: "alert" }, el("p", { textContent: `Não consegui carregar (${ea.erro}).` }),
        el("button", { type: "button", className: "sugestao", textContent: "Tentar de novo", onclick: carregarEmAberto }))
      : el("p", { className: "pn-msg", textContent: "Juntando as abertas…" }));
    return;
  }
  const pct = (n) => d.total ? `${Math.round((n / d.total) * 100)}% do total` : "";
  const numero = (rotulo, valor, sub, dica) => el("div", { className: "pn-cartao", title: dica || "" },
    el("span", { className: "pn-rotulo", textContent: rotulo }), el("strong", { className: "pn-valor", textContent: valor }),
    sub ? el("span", { className: "pn-sub", textContent: sub }) : null);
  const barras = (itens) => (clicar) => barrasComQuem(itens || [], d.total, clicar);
  const nos = [topo];
  if (ea.erro) nos.push(el("p", { className: "pn-erro", role: "alert", textContent: `Não consegui atualizar agora (${ea.erro}): números de ${quando(new Date(ea.em).toISOString())}.` }));
  nos.push(el("div", { className: "pn-cartoes" },
    numero("Em aberto", mil(d.total), `de ${mil(d.solicitantes_total)} solicitantes · ainda não terminaram`,
      "Solicitações que ainda não foram encerradas, reprovadas nem canceladas no Webformat."),
    numero("Esperando o solicitante", mil(d.pendencia_tecnica), `${pct(d.pendencia_tecnica)} · a CH devolveu com pendência`,
      "Pendência técnica: a CH devolveu ao solicitante pedindo informação; a solicitação só anda quando ele responde."),
    numero("Com a CH", mil(d.com_a_ch), `${pct(d.com_a_ch)} · em análise na consultoria`,
      "Com a CH (a consultoria de cadastro) agora, na análise técnica."),
    numero("Urgentes", mil(d.urgentes), `${pct(d.urgentes)} · marcadas na abertura`,
      "Marcadas como urgentes pelo solicitante quando abriu a solicitação."),
  ));
  if (d.parada_mediana_dias !== null && d.parada_mediana_dias !== undefined) {
    nos.push(el("p", { className: "pn-nota", textContent: `Metade das abertas teve o último trâmite há até ${mil(d.parada_mediana_dias)} ` +
      `${d.parada_mediana_dias === 1 ? "dia" : "dias"}.` }));
  }
  nos.push(...fonteDoEmAberto(d.fonte));
  const pc = d.pedem_certo;
  // a frase de resumo de cada card, tirada dos mesmos números das barras
  const p100 = (n) => d.total ? Math.round((n / d.total) * 100) : 0;
  const maior = (l) => (l || []).filter((x) => x.rotulo !== "Outros").reduce((m, x) => (!m || x.n > m.n ? x : m), null);
  const r = {};
  const cq = maior(d.com_quem);
  if (cq) r.com_quem = /^solicitante/i.test(cq.rotulo)
    ? `A maior parte está esperando o solicitante responder uma pendência técnica: ${mil(cq.n)} (${p100(cq.n)}% da fila).`
    : `A maior parte está com ${cq.rotulo}: ${mil(cq.n)} (${p100(cq.n)}% da fila).`;
  const id = d.idade || [];
  if (id.length) {
    const velhas = id[id.length - 1], novas = id[0];
    r.idade = `${p100(velhas.n)}% estão paradas há ${velhas.rotulo} (${mil(velhas.n)}); ${p100(novas.n)}% andaram ${novas.rotulo.replace(/^até/, "nos últimos")}.`;
  }
  const fora = (d.horas_ch || []).filter((x) => x.alerta).reduce((t, x) => t + x.n, 0);
  if (d.com_a_ch) r.horas_ch = fora
    ? `${mil(fora)} das ${mil(d.com_a_ch)} com a CH (${Math.round((fora / d.com_a_ch) * 100)}%) já passaram do prazo de 48 h úteis.`
    : `Todas as ${mil(d.com_a_ch)} com a CH estão dentro do prazo de 48 h úteis.`;
  const tp = maior(d.tipos);
  if (tp) r.tipos = `${tp.rotulo} é ${p100(tp.n)}% das abertas (${mil(tp.n)}).`;
  const ev = ((pn.dados && pn.dados.evolucao) || []).filter((f) => typeof f.em_aberto === "number");
  if (ev.length) {
    const dif = d.total - ev[0].em_aberto;
    r.evolucao = dif === 0 ? `A fila está do mesmo tamanho de ${ddmmDe(ev[0].dia)}: ${mil(d.total)}.`
      : `De ${mil(ev[0].em_aberto)} em ${ddmmDe(ev[0].dia)} para ${mil(d.total)} agora: a fila ${dif > 0 ? "cresceu" : "diminuiu"} ${mil(Math.abs(dif))}.`;
  }
  if (d.total) r.urgencia = `${p100(d.urgentes)}% das abertas estão marcadas como urgentes (${mil(d.urgentes)} de ${mil(d.total)}).`;
  const gm = maior(d.grupos);
  if (gm) r.grupos = `O grupo ${gm.rotulo} sozinho tem ${p100(gm.n)}% das abertas (${mil(gm.n)}).`;
  const top3 = (d.solicitantes || []).slice(0, 3).reduce((t, x) => t + x.n, 0);
  if (top3) r.solicitantes = `As 3 pessoas com mais abertas somam ${mil(top3)}: ${p100(top3)}% da fila.`;
  const lider = pc && pc.itens && pc.itens[0];
  if (lider) r.pede_certo = `${lider.rotulo} lidera: ${mil(lider.certos)} de ${mil(lider.pedidos)} cadastradas sem nenhuma pendência técnica (${lider.taxa}%).`;
  const grade = el("div", { className: "ea-grade" },
    // em pares de altura parecida (lado a lado na tela larga): barras curtas, colunas, as 8 maiores;
    // os largos ocupam a linha toda
    caixaEa("Com quem está", "onde cada uma espera agora",
      { resumo: r.com_quem, explica:
        "Em que etapa cada solicitação aberta está parada agora: com o solicitante (pendência técnica), com a CH, com o " +
      "Master Data ou com uma área técnica. Cada uma conta uma vez só, então a soma das barras dá o total em aberto." },
      barras(d.com_quem)),
    caixaEa("Tipo de material", "",
      { resumo: r.tipos, explica:
        "O tipo pedido em cada aberta: ZMAT é material de estoque, NLAG é compra pontual (não fica em estoque), SERV e DIEN " +
      "são serviços; ZQUI passa também por Gestão de Fornecedores e ZHID por Hidrometria." },
      barras(d.tipos)),
    caixaEa("Há quanto tempo estão paradas", "desde o último trâmite; \"2 a 5\" = mais de 2 até 5 dias",
      { resumo: r.idade, explica:
        "Dias corridos desde o último trâmite de cada aberta (não desde a abertura): mostra o que parou de andar. " +
      "Quanto mais à direita, mais tempo sem nenhuma movimentação." },
      (clicar) => colunas(d.idade, clicar)),
    caixaEa("Horas úteis na CH", `as ${mil(d.com_a_ch)} com a CH; soma das passagens, como no Relatório Gerencial · prazo: 24 a 48 h` +
      (d.horas_ch_sem_dado ? ` · ${mil(d.horas_ch_sem_dado)} sem a hora ainda` : ""),
      { resumo: r.horas_ch, explica:
        "Só as que estão com a CH agora: quantas horas úteis a CH já usou em cada uma, somando todas as vezes que passou por " +
      "ela (24 h por dia útil, de segunda a sexta). Em laranja, as que já passaram do prazo de 48 h úteis." },
      (clicar) => colunas(d.horas_ch, clicar)),
    caixaEa("Evolução da fila", "a manhã de cada dia útil e o agora",
      { resumo: r.evolucao, explica:
        "Quantas estavam em aberto (linha cheia) e em pendência técnica (tracejada) na manhã de cada dia útil; o anel no fim " +
      "é o número de agora. Linha subindo é a fila crescendo; descendo, a fila andando." },
      () => linhaDaFila(pn.dados && pn.dados.evolucao, { abertas: d.total, pendencia_tecnica: d.pendencia_tecnica }, d.fonte && d.fonte.lido_em), true),
    caixaEa("Grupos de mercadorias", "os 8 com mais abertas",
      { resumo: r.grupos, explica:
        "O grupo de mercadorias é a família do material no SAP (tubos, válvulas, peças...). Aqui, os 8 grupos com mais " +
      "solicitações abertas: onde está o volume de cadastro." },
      barras(d.grupos)),
    caixaEa("Solicitantes", `os 8 com mais abertas, de ${mil(d.solicitantes_total)}`,
      { resumo: r.solicitantes, explica:
        "As 8 pessoas com mais solicitações abertas agora, em qualquer etapa (com a CH, com o Master Data, em pendência...)." },
      barras(d.solicitantes)),
    caixaEa("Urgência", "",
      { resumo: r.urgencia, explica:
        "Quantas abertas o solicitante marcou como urgentes na abertura. Quando quase tudo é urgente, a marca deixa de " +
      "mostrar o que é prioridade de verdade." },
      barras(d.urgencia), true),
    pc && pc.itens && pc.itens.length ? caixaEa("Quem mais pede certo",
      `das terminadas nos últimos ${mil(pc.dias)} dias · quem teve ${mil(pc.minimo)} ou mais`,
      { resumo: r.pede_certo, explica:
        `Das solicitações de cada pessoa que terminaram nos últimos ${mil(pc.dias)} dias, a porcentagem cadastrada sem ` +
      "nenhuma pendência técnica: a CH nunca precisou devolver. Reprovada e cancelada contam como não certas. A ordem junta " +
      "a porcentagem e a quantidade: quem pede muito e certo fica no topo (19 certas de 20 vem antes de 2 de 2)." },
      () => barrasAcerto(pc.itens), true) : null,
  );
  nos.push(grade);
  nos.push(el("p", { className: "pn-nota fim", textContent: "Os mesmos números do painel. Cada barra dá o mesmo número da lista que o clique traz. " +
    "Os números da tela não usam a IA." }));
  $("pn-corpo").replaceChildren(...nos);
}

// ------------------------------------------------------------ parecidos (busca de material sem nada exato)
// Cartões com a ilustração da família da peça (o catálogo não tem fotos), a porcentagem de semelhança e o
// que muda. A porcentagem vem da função (palavras que batem e o quanto o texto se parece); nunca 100%.
const FAMILIAS = [
  [/^(CAPACETE|LUVA (?:NITR|LATEX|VAQ|PROT|SEG|ISOL|RASPA|MALHA|ANTICORTE|DE PROCED)|BOTA|BOTINA|CALCADO|OCULOS|PROTETOR|ABAFADOR|RESPIRADOR|MASCARA|CINTO|UNIFORME|JAQUETA|AVENTAL|EPI)/, "M4 16a8 8 0 0 1 16 0zM2 16h20v3H2zM12 8V5"],
  [/^(VALV|REGISTRO|VRP|COMPORTA|ADUFA)/, "M3 9v6M21 9v6M3 12h3M18 12h3M6 8l12 8V8L6 16zM12 12V5M9 5h6"],
  [/^(MED|MEDIDOR|HIDROM|TRANSM|MANOMETRO|SENSOR|CONVERSOR|ANALISADOR|MACROMEDIDOR)/, "M5 15a7 7 0 1 1 14 0M12 15l4-4M3 19h18M12 15h.01"],
  [/^(TUBO|CANO|CURVA|JOELHO|COTOVELO|TE\b|TEE|LUVA|CONEX|FLANGE|TOCO|CARRETEL|SPOOL|REDUC|NIPLE|BUJAO|CAP\b|BUCHA|JUNTA|ADAPTADOR|COLAR)/,
    "M2 9h20v6H2zM6 7v10M18 7v10"],
  [/^(FRASCO|PROVETA|BECKER|BEQUER|PIPETA|BALAO|TUBO DE ENSAIO|REAGENTE|PADRAO|SOLUCAO|KIT TESTE|TESTE)/, "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"],
  [/^(PARAF|PORCA|ARRUELA|PINO|REBITE|CHUMBADOR|PRISIONEIRO|ABRACADEIRA|BRACADEIRA)/, "M7 3h10v4H7zM10 7h4v14h-4zM10 11h4M10 15h4"],
  [/^(CABO|FIO|DISJ|CONTAT|RELE|FUSIVEL|LAMPADA|LUMINARIA|TRANSFORMADOR|TRAFO|INVERSOR|SOFT|CLP|BATERIA|NOBREAK|TOMADA|INTERRUPTOR)/, "M13 2 4 14h7l-1 8 9-12h-7z"],
  [/^(BOMBA|MOTOR|MOTOBOMBA|COMPRESSOR|SOPRADOR|ROTOR|ROLAM|ACOPL|REDUTOR|AGITADOR|MISTURADOR)/, "M3 8h11v8H3zM14 10h3v4h-3M17 12h4M6 16v3M11 16v3"],
];
const CAIXA = "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10";

function ilustracao(texto) {
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const f = FAMILIAS.find(([re]) => re.test(t));
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", f ? f[1] : CAIXA);
  s.append(p);
  return el("span", { className: "pa-foto", title: "Ilustração da família da peça (o catálogo do SAP não tem foto)" }, s);
}

function cartaoParecido(p) {
  const pct = Math.max(1, Math.min(99, Math.round(Number(p.semelhanca) || 0)));
  const medidor = el("span", { className: "pa-medidor", role: "img", ariaLabel: `${pct}% parecido` }, el("i"));
  medidor.firstChild.style.width = `${pct}%`;
  const difs = Array.isArray(p.diferencas) ? p.diferencas.slice(0, 3) : [];
  return el("div", { className: "parecido" + (p.bloqueio ? " bloqueado" : "") },
    ilustracao(p.texto),
    el("div", { className: "pa-corpo" },
      el("div", { className: "pa-topo" }, botaoCodigo(String(p.codigo)),
        el("span", { className: "pa-pct" }, el("b", { textContent: `${pct}%` }), " parecido"), medidor),
      el("p", { className: "pa-texto", textContent: p.texto || "" }),
      el("div", { className: "pa-selos" },
        p.bate ? el("span", { className: `etiqueta ${difs.length ? "azul" : "verde"}`, textContent: String(p.bate) }) : null,
        ...difs.map((x) => el("span", { className: "etiqueta amarelo", textContent: String(x) })),
        seloBloqueio(p.bloqueio),
        p.tipo ? el("span", { className: "etiqueta cinza", textContent: String(p.tipo) }) : null,
        p.usar_no_lugar ? el("span", { className: "etiqueta vermelho", textContent: `use o ${p.usar_no_lugar}` }) : null)));
}

// ------------------------------------------------------------ telas e eventos

// Entrada em abas: "Sou da Sabesp" (chave de acesso) e "Sou da Meetup" (conta Microsoft).
// Sem uma das formas (o servidor diz), fica so a outra, sem abas.
function telas() {
  document.body.classList.toggle("logado", !!codigo);
  if (!formas.microsoft) aba = "sabesp";
  else if (!formas.codigo) aba = "meetup";
  $("abas").hidden = !(formas.microsoft && formas.codigo);
  $("aba-sabesp").setAttribute("aria-selected", String(aba === "sabesp"));
  $("aba-meetup").setAttribute("aria-selected", String(aba === "meetup"));
  $("form-codigo").hidden = !!codigo || aba !== "sabesp";
  $("entrada-ms").hidden = !!codigo || aba !== "meetup";
  if (codigo) $("erro-codigo").hidden = true;
  $("chat").hidden = !codigo;
  // o botao do tema fica no canto da entrada ou na barra da conversa
  (codigo ? $("tema-chat") : $("tema-entrada")).append($("tema"));
  if (codigo) { redesenhar(); if (!cat.aberto) $("mensagem").focus(); } else if (aba === "sabesp") $("codigo").focus();
  // link de uma busca do catalogo: abre depois de entrar
  if (codigo && linkPendente) {
    const h = linkPendente;
    linkPendente = "";
    abrirLinkDoCatalogo(h);
  } else if (codigo && !pn.visto && !cat.aberto && (!historico.length || LINKS_DO_PAINEL[location.hash])) {
    // a primeira tela depois de entrar: o painel (com a conversa vazia ou pelo link #painel / #pendencias)
    abrirPainel(LINKS_DO_PAINEL[location.hash]);
  }
}

function trocarAba(qual) {
  aba = qual;
  $("erro-codigo").hidden = true;
  telas();
}

// A chave como a pessoa colou ("bella k7qf 2mxp 9dwr", sem o "BELLA-", minuscula) no formato certo.
// A funcao tambem normaliza; aqui e para mostrar "formato certo" e completar o "BELLA" que faltou.
function chaveNormal(t) {
  const s = String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const c = /^[A-Z0-9]{12}$/.test(s) && !s.startsWith("BELLA") ? `BELLA${s}` : s;
  return /^BELLA[A-Z0-9]{12}$/.test(c) ? `BELLA-${c.slice(5, 9)}-${c.slice(9, 13)}-${c.slice(13)}` : "";
}

function conferirChave() {
  const t = $("codigo").value.trim();
  const ok = !!chaveNormal(t);
  $("campo-chave").classList.toggle("ok", ok);
  $("campo-chave").classList.remove("erro");
  $("dica-chave").classList.toggle("ok", ok);
  $("dica-chave").textContent = ok ? "✓ Chave no formato certo. Pode entrar!"
    : t ? "A chave tem BELLA e mais 12 letras e números." : "Pode colar do jeito que recebeu, com ou sem traços. Fica guardada só neste navegador.";
}

// [título, texto, tom]: "espera" (amarelo) quando não é erro de quem tentou entrar
const AVISOS_DE_CODIGO = {
  invalido: ["Hmm, não reconheci essa chave 🤔", "Confira se copiou inteira a chave que o Luiz Henrique Brambilla Teixeira te passou. Quem é da Meetup entra pela aba “Sou da Meetup”.", "erro"],
  expirado: ["Chave expirada", "Ela ficou 60 dias sem uso. Peça uma nova ao Luiz Henrique Brambilla Teixeira, do time de Master Data.", "espera"],
  sessao: ["Sua entrada terminou", "É só entrar de novo com a conta Microsoft.", "espera"],
  "sessao-expirada": ["Sua entrada expirou", "Ela ficou 30 dias sem uso. É só entrar de novo com a conta Microsoft.", "espera"],
  "so-microsoft": ["Use a conta Microsoft", "Quem é da Meetup entra pelo botão da Microsoft. A chave de acesso é só para usuários da Sabesp.", "espera"],
  "time-desativado": ["O código do time não vale mais", "Quem é da Meetup entra com a conta Microsoft. Usuários da Sabesp: peça a sua chave pessoal ao Luiz Henrique Brambilla Teixeira.", "espera"],
  negada: ["Conta não liberada", "Sua conta Microsoft não está liberada na Bella. Fale com o Luiz Henrique Brambilla Teixeira.", "erro"],
  bloqueada: ["Acesso aguardando liberação", "Seu login foi registrado. Avise o Luiz Henrique Brambilla Teixeira para liberar o seu acesso e depois entre de novo.", "espera"],
  cancelada: ["Entrada cancelada", "Quando quiser, é só clicar em “Entrar com a conta Microsoft”.", "espera"],
  aprovacao: ["Falta uma aprovação", "A Microsoft pediu a aprovação do administrador (T.I da Meetup) para liberar o login. Avise o Luiz.", "espera"],
  erro: ["Não deu para entrar agora", "A conta Microsoft não respondeu. Tente de novo em alguns minutos.", "erro"],
};

function mostrarAviso(titulo, texto, tom = "erro") {
  $("erro-titulo").textContent = titulo;
  $("erro-texto").textContent = texto;
  $("erro-codigo").dataset.tom = tom;
  $("erro-codigo").hidden = false;
}

// erro do 401 -> qual aviso mostrar
const tipoDoBarrado = (erro) => ({
  "código de acesso expirado": "expirado", "sessão expirada": "sessao-expirada", "sessão encerrada": "sessao",
  "entre com a conta Microsoft": "so-microsoft", "código do time desativado": "time-desativado",
})[erro] || "invalido";

function avisarCodigo(tipo) {
  // erro da chave: aba da chave aberta e o campo em vermelho; o resto e da conta Microsoft
  aba = tipo === "invalido" || tipo === "expirado" || tipo === "time-desativado" ? "sabesp" : "meetup";
  telas();
  mostrarAviso(...AVISOS_DE_CODIGO[tipo]);
  if (aba === "sabesp") {
    conferirChave();
    $("campo-chave").classList.replace("ok", "erro") || $("campo-chave").classList.add("erro");
    $("dica-chave").classList.remove("ok");
    $("dica-chave").textContent = "Pode colar do jeito que recebeu, com ou sem traços.";
  }
}

// botao Sair: encerra tambem a sessao no servidor (o codigo de acesso continua valendo)
function sairDeVez() {
  if (ehSessao(codigo)) {
    fetch(`${API}?sair=1`, { method: "POST", headers: { "x-codigo": codigo }, keepalive: true, referrerPolicy: "no-referrer" })
      .catch(() => {});
  }
  sair();
}

// Volta do login Microsoft: #sessao=...&estado=... (ou #entrada=negada|cancelada|aprovacao|erro).
// So aceita a sessao se o estado for o que esta aba criou ao clicar no botao.
function voltaDaMicrosoft() {
  if (!/(^#|&)(sessao|entrada)=/.test(location.hash)) return;
  const h = new URLSearchParams(location.hash.slice(1));
  const busca = new URLSearchParams(location.search);
  busca.delete("v");   // ?v= da volta do login (so para nao pegar a pagina guardada)
  history.replaceState(null, "", location.pathname + (busca.size ? `?${busca}` : ""));
  const esperado = ler(sessionStorage, "consulta-estado");
  try { sessionStorage.removeItem("consulta-estado"); } catch (e) { /* ok */ }
  const s = h.get("sessao") || "";
  if (s && ehSessao(s) && esperado && h.get("estado") === esperado) {
    codigo = s;
    guardar(localStorage, "consulta-codigo", s);
    esperandoNome = true;
    return;
  }
  const tipo = s ? "erro" : h.get("entrada");
  avisarCodigo(AVISOS_DE_CODIGO[tipo] && tipo !== "invalido" ? tipo : "erro");
}

function entrarComMicrosoft() {
  const estado = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  guardar(sessionStorage, "consulta-estado", estado);
  location.href = `${API}?entrar=1&estado=${estado}`;
}

async function carregarFormas() {
  try {
    const r = await fetch(`${API}?entrada=1`, { cache: "no-store", referrerPolicy: "no-referrer" });
    const d = await r.json();
    formas = { microsoft: formas.microsoft || !!d.microsoft, codigo: d.codigo !== false };
  } catch (e) { /* fica como estava */ }
  telas();
}

function sair() {
  codigo = "";
  nome = "";
  codigoDoTime = false;
  try {
    for (const k of ["consulta-codigo", "consulta-nome", "consulta-time"]) localStorage.removeItem(k);
  } catch (e) { /* ok */ }
  espera++;
  // as conversas eram de quem saiu: nao ficam na aba para a proxima pessoa (as do historico continuam la)
  nuvem = false;
  historicoPedido = false;
  pendentes.clear();
  conversas = [];
  historico = [];
  salvarConversas();
  salvarNaAba();
  sessao = novoId();
  guardar(sessionStorage, "consulta-sessao", sessao);
  cancelarEdicao(true);
  // o painel tinha as solicitacoes de quem saiu
  fecharPainel();
  pn.dados = null;
  pn.visto = false;
  pn.aba = "fila";
  pn.trocarNome = false;
  telas();
}

// De quem e o codigo (o nome aparece no "Oi, Luiz!"); codigo que deixou de valer sai.
async function quemSou() {
  const d = await chamar({ quem: 1 });
  nome = typeof d.nome === "string" ? d.nome : "";
  codigoDoTime = !d.pessoal && !d.microsoft;
  guardar(localStorage, "consulta-nome", nome);
  guardar(localStorage, "consulta-time", codigoDoTime ? "1" : "");
  // o historico e pessoal: so com chave pessoal ou conta Microsoft; depois, o passeio da primeira visita
  if (d.pessoal || d.microsoft) carregarHistorico().finally(talvezPasseio); else talvezPasseio();
}

$("form-codigo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const c = chaveNormal($("codigo").value) || $("codigo").value.trim();
  if (!c) return;
  const botao = $("form-codigo").querySelector(".botao-entrar");
  botao.disabled = true;
  $("erro-codigo").hidden = true;
  codigo = c;
  try {
    await quemSou();
    guardar(localStorage, "consulta-codigo", c);
    $("codigo").value = "";
    conferirChave();
    telas();
  } catch (e) {
    codigo = "";
    if (e instanceof ErroConsulta && e.message === "código de acesso expirado") avisarCodigo("expirado");
    else if (e instanceof ErroConsulta && e.message === "código de acesso inválido") avisarCodigo("invalido");
    else if (e instanceof ErroConsulta && e.message === "entre com a conta Microsoft") avisarCodigo("so-microsoft");
    else if (e instanceof ErroConsulta && e.message === "código do time desativado") avisarCodigo("time-desativado");
    else {
      mostrarAviso("Não deu para entrar agora", e instanceof ErroConsulta ? e.message : "Erro inesperado. Tente de novo.");
    }
    telas();
  } finally {
    botao.disabled = false;
  }
});

$("form-chat").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (ocupado) { pararResposta(); return; }
  const t = $("mensagem").value;
  if (!t.trim()) return;
  $("mensagem").value = "";
  ajustarAltura();
  const u = editando ? ultimaTroca() : null;
  cancelarEdicao();
  if (u) perguntarDeNovo(u, t); else enviar(t);
});

// Enter envia; Shift+Enter quebra a linha; seta para cima com a caixa vazia edita a ultima pergunta
$("mensagem").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    if (!ocupado) $("form-chat").requestSubmit();  // Enter nunca para a resposta: so o botao
  } else if (ev.key === "ArrowUp" && !ev.shiftKey && !ev.isComposing && !$("mensagem").value) {
    ev.preventDefault();
    editarUltima();
  }
});
function ajustarAltura() {
  const t = $("mensagem");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
}
$("mensagem").addEventListener("input", () => { ajustarAltura(); atualizarBotao(); });

// subiu para reler: botao "ir para o fim"
$("conversa").addEventListener("scroll", () => {
  const c = $("conversa");
  $("ir-fim").hidden = c.scrollHeight - c.scrollTop - c.clientHeight < 240;
}, { passive: true });
$("ir-fim").addEventListener("click", () => rolar(true));

$("nova").addEventListener("click", novaConversa);
$("nova-cel").addEventListener("click", novaConversa);
$("whatsapp").addEventListener("click", () => { fecharLado(); abrirWhatsapp(); });
$("wa-fechar").addEventListener("click", () => $("painel-whatsapp").close());
// clique fora do painel (no fundo escuro) fecha
$("painel-whatsapp").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
$("sair").addEventListener("click", sairDeVez);
$("entrar-ms").addEventListener("click", entrarComMicrosoft);
$("aba-sabesp").addEventListener("click", () => trocarAba("sabesp"));
$("aba-meetup").addEventListener("click", () => trocarAba("meetup"));
$("codigo").addEventListener("input", conferirChave);
$("mostrar").addEventListener("click", () => {
  const ver = $("codigo").type === "password";
  $("codigo").type = ver ? "text" : "password";
  $("mostrar").textContent = ver ? "esconder" : "mostrar";
  $("mostrar").setAttribute("aria-pressed", String(ver));
  $("codigo").focus();
});
// atalhos do menu: "Procurar material" comeca a pergunta; "Minhas solicitacoes" ja pergunta
$("atalho-material").addEventListener("click", abrirCatalogo);
$("atalho-painel").addEventListener("click", abrirPainel);
$("atalho-minhas").addEventListener("click", () => { fecharLado(); fecharCatalogo(); enviar("como estão as minhas solicitações?"); });
// catalogo: texto busca quando a pessoa para de digitar; filtros na hora
$("cat-texto").addEventListener("input", () => { cat.pagina = 1; buscarNoCatalogo(350); });
$("cat-texto").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); cat.pagina = 1; buscarNoCatalogo(); } });
$("cat-gm").addEventListener("input", () => { cat.pagina = 1; buscarNoCatalogo(450); });
for (const id of ["cat-tipo", "cat-usar", "cat-errado"]) $(id).addEventListener("change", () => { cat.pagina = 1; buscarNoCatalogo(); });
$("cat-bloqueio").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  cat.bloqueio = b.dataset.bloqueio;
  cat.pagina = 1;
  buscarNoCatalogo();
});
$("cat-limpar").addEventListener("click", limparFiltrosDoCatalogo);
$("cat-novidade").addEventListener("click", fecharCatalogo);
// link de busca colado nesta mesma aba
window.addEventListener("hashchange", () => {
  if (LINKS_DO_PAINEL[location.hash] && codigo) { abrirPainel(LINKS_DO_PAINEL[location.hash]); return; }
  if (!/^#catalogo(&|$)/.test(location.hash)) return;
  if (codigo) abrirLinkDoCatalogo(location.hash); else linkPendente = location.hash;
});
$("abrir-lado").addEventListener("click", abrirLado);
$("fechar-lado").addEventListener("click", fecharLado);
$("cortina").addEventListener("click", fecharLado);
$("cancelar-edicao").addEventListener("click", () => { cancelarEdicao(true); $("mensagem").focus(); });
$("ver-atalhos").addEventListener("click", () => { fecharLado(); abrirAtalhos(); });
$("atalhos-fechar").addEventListener("click", () => $("painel-atalhos").close());
$("painel-atalhos").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
$("atalho-material").title = `Procurar material (${CTRL}+K)`;

// ------------------------------------------------------------ atalhos do teclado
const ATALHOS = [
  [[CTRL, "Shift", "O"], "Nova conversa"],
  [[CTRL, "K"], "Procurar material"],
  [["/"], "Ir para a caixa de mensagem"],
  [["↑"], "Editar a última pergunta (com a caixa vazia)"],
  [["Enter"], "Enviar"],
  [["Shift", "Enter"], "Quebrar a linha"],
  [["Esc"], "Parar a resposta, cancelar a edição ou fechar o catálogo e o painel"],
  [[CTRL, "/"], "Ver estes atalhos"],
];

function abrirAtalhos() {
  $("lista-atalhos").replaceChildren(...ATALHOS.flatMap(([teclas, oque]) => [
    el("dt", {}, ...teclas.map((t) => el("kbd", { textContent: t }))),
    el("dd", { textContent: oque }),
  ]));
  if (!$("painel-atalhos").open) $("painel-atalhos").showModal();
}

const emCampo = (alvo) => alvo instanceof HTMLElement && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName));

document.addEventListener("keydown", (ev) => {
  if (ev.isComposing || document.querySelector("dialog[open]")) return;   // o painel aberto cuida do proprio Esc
  if (ev.key === "Escape") {
    if ($("lado").classList.contains("aberto")) fecharLado();
    else if (ocupado) pararResposta();
    else if (editando) { cancelarEdicao(true); $("mensagem").focus(); }
    // no campo de busca do catalogo o Esc primeiro limpa o texto (do proprio navegador)
    else if (cat.aberto && !(ev.target === $("cat-texto") && $("cat-texto").value)) fecharCatalogo();
    else if (pn.aberto) fecharPainel();
    return;
  }
  if (!codigo) return;
  const mod = MAC ? ev.metaKey : ev.ctrlKey;
  const tecla = ev.key.toLowerCase();
  if (mod && ev.shiftKey && tecla === "o") {
    ev.preventDefault();
    novaConversa();
  } else if (mod && !ev.shiftKey && tecla === "k") {
    ev.preventDefault();
    if (cat.aberto) $("cat-texto").focus(); else abrirCatalogo();
  } else if (mod && ev.key === "/") {
    ev.preventDefault();
    abrirAtalhos();
  } else if (ev.key === "/" && !mod && !ev.altKey && !emCampo(ev.target)) {
    ev.preventDefault();
    (cat.aberto ? $("cat-texto") : $("mensagem")).focus();
  }
});
// ------------------------------------------------------------ primeira visita: passeio pela pagina
// Uma vez por navegador (consulta-passeio); da para ver de novo no painel de atalhos. O balao e um
// <dialog> do tamanho da tela: o resto da pagina fica escurecido e sem clique, com um "furo" no alvo.
let passeio = null;   // {passos, i}
const celular = () => !!window.matchMedia && matchMedia("(max-width: 760px)").matches;

function passosDoPasseio() {
  const vazia = $("chat").classList.contains("vazia");
  const passos = [{
    alvo: vazia ? "sugs" : "form-chat", titulo: "Pergunte do seu jeito",
    texto: "Escreva como está no pedido, abreviado mesmo (VLV GAV DN100, LUVA PVC SOLD 50, “tá com a CH?”). " +
      "A Bella procura no catálogo do SAP, no Webformat e nos casos já resolvidos" + (vazia ? ", ou comece por uma destas sugestões." : "."),
  }, {
    alvo: "form-chat", titulo: "Com o número, a ficha na hora",
    texto: "“Situação da 1234”, “o que a CH pediu na 1234?”: a ficha é lida no Webformat na hora, " +
      "com quem está, há quanto tempo e o último trâmite. Clique num número ou código na resposta para abrir os detalhes.",
  }];
  if (celular()) {
    passos.push({ alvo: "abrir-lado", titulo: "Tudo no menu ☰",
      texto: "O painel da fila (com a tela Em aberto), procurar material no SAP, as suas solicitações e as conversas guardadas." });
  } else {
    passos.push({ alvo: "atalho-painel", titulo: "Painel da fila",
      texto: "Os números do Webformat agora. Em “Em aberto”: com quem está, há quanto tempo, horas na CH, tipos e a evolução " +
        "dia a dia e quem mais pede certo. Clique numa barra e a lista vem na conversa, com o mesmo número." });
    passos.push({ alvo: "atalho-material", titulo: "Procurar material",
      texto: "O catálogo do SAP com filtros de tipo, grupo de mercadorias e bloqueio, e os parecidos com a porcentagem de " +
        "semelhança. Dá para mandar o link da busca para alguém." });
    passos.push({ alvo: "atalho-minhas", titulo: "Minhas solicitações",
      texto: "As solicitações no seu nome: situação, com quem está e o último trâmite. As que esperam a sua resposta ficam no painel, em “Minhas pendências”." });
    if (nuvem) {
      passos.push({ alvo: "nova", titulo: "Conversas guardadas",
        texto: "Por 30 dias, só para você: aparecem aqui embaixo para reabrir, e o × apaga. Conversa nova começa por este botão." });
    }
    passos.push({ alvo: "ver-atalhos", titulo: "Atalhos do teclado",
      texto: `${CTRL}+K procura material, / vai para a caixa de mensagem e ↑ edita a última pergunta. Todos estão aqui.` });
  }
  passos.push({ alvo: null, titulo: "É isso! 💙",
    texto: "Embaixo de cada resposta tem 👍 e 👎. Quando a resposta não ajudar, conte o que faltou: é assim que a Bella melhora. " +
      "Na dúvida, confira no Webformat ou no SAP antes de decidir." });
  return passos;
}

// muda a versao quando o passeio ganha passos novos: quem ja viu o antigo ve de novo uma vez
const VERSAO_PASSEIO = "2";

function talvezPasseio() {
  if (ler(localStorage, "consulta-passeio") === VERSAO_PASSEIO) return;
  setTimeout(() => { if (!ocupado && !cat.aberto) abrirPasseio(); }, 600);
}

function abrirPasseio() {
  if (!codigo || $("chat").hidden || document.querySelector("dialog[open]")) return;
  fecharLado();
  fecharCatalogo();
  const comPainel = pn.aberto;
  fecharPainel();
  passeio = { passos: passosDoPasseio(), i: 0, comPainel };
  $("tour").showModal();
  mostrarPasso();
}

function mostrarPasso() {
  const { passos, i } = passeio;
  const p = passos[i];
  const ultimo = i === passos.length - 1;
  $("tour-passo").textContent = `${i + 1} de ${passos.length}`;
  $("tour-titulo").textContent = p.titulo;
  $("tour-texto").textContent = p.texto;
  $("tour-proximo").textContent = ultimo ? "Começar!" : "Próximo";
  $("tour-pular").hidden = ultimo;
  posicionarPasso();
  $("tour-proximo").focus();
}

// o "furo" em volta do alvo e o balao ao lado (direita, embaixo ou em cima: o que couber na tela)
function posicionarPasso() {
  if (!passeio) return;
  const p = passeio.passos[passeio.i];
  const alvo = p.alvo ? $(p.alvo) : null;
  const r = alvo && alvo.getClientRects().length ? alvo.getBoundingClientRect() : null;
  const foco = $("tour-foco"), balao = $("tour-balao");
  const W = innerWidth, H = innerHeight, M = 16, F = 6, D = 14;
  foco.style.left = `${r ? r.left - F : W / 2}px`;
  foco.style.top = `${r ? r.top - F : H / 2}px`;
  foco.style.width = `${r ? r.width + 2 * F : 0}px`;
  foco.style.height = `${r ? r.height + 2 * F : 0}px`;
  const bw = balao.offsetWidth, bh = balao.offsetHeight;
  let x, y;
  if (!r) { x = (W - bw) / 2; y = (H - bh) / 2; }
  else if (r.right + D + bw <= W - M) { x = r.right + D; y = r.top; }
  else if (r.bottom + D + bh <= H - M) { x = r.left; y = r.bottom + D; }
  else { x = r.left; y = r.top - D - bh; }
  balao.style.left = `${Math.min(Math.max(x, M), W - bw - M)}px`;
  balao.style.top = `${Math.min(Math.max(y, M), H - bh - M)}px`;
}

function fecharPasseio() {
  const voltar = passeio && passeio.comPainel;
  passeio = null;
  guardar(localStorage, "consulta-passeio", VERSAO_PASSEIO);
  if ($("tour").open) $("tour").close();
  if (voltar && codigo) abrirPainel();
  else if (!cat.aberto) $("mensagem").focus();
}

$("tour-proximo").addEventListener("click", () => {
  if (!passeio) return;
  if (passeio.i === passeio.passos.length - 1) { fecharPasseio(); return; }
  passeio.i++;
  mostrarPasso();
});
$("tour-pular").addEventListener("click", fecharPasseio);
$("tour").addEventListener("close", () => { if (passeio) fecharPasseio(); });   // Esc
window.addEventListener("resize", posicionarPasso);
$("rever-tour").addEventListener("click", () => { $("painel-atalhos").close(); abrirPasseio(); });

// saindo da pagina: o que ainda esperava vai para o historico
window.addEventListener("pagehide", () => { if (pendentes.size) mandarPendentes(); });
// no celular o texto de exemplo do campo fica curto (o longo nao cabe numa linha)
if (window.matchMedia && matchMedia("(max-width: 760px)").matches) $("mensagem").placeholder = "Pergunte à Bella…";
desenharSugestoes();
voltaDaMicrosoft();
telas();
carregarFormas();
atualizarBotao();
// ja tinha entrado: confere o codigo e o nome (o codigo do time vale ate virar so pessoal)
if (codigo) {
  quemSou().catch(() => {}).finally(() => {
    esperandoNome = false;
    if (codigo && !ocupado) redesenhar();
    if (pn.aberto && pn.dados) desenharPainel();   // agora com o nome no "Bom dia, Luiz!"
  });
}
