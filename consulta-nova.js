// Consulta da Bella, tela nova (consulta-nova.html): a mesma logica da consulta.js, com
// menu lateral, conversa no meio, sugestoes coloridas e a Bella mostrando o que consulta.
// Seguranca (igual a consulta.js):
//  - o endereco da funcao e fixo; a politica da pagina tambem so deixa falar com ele;
//  - todo texto que vem da funcao entra como texto (textContent), nunca como
//    HTML: o markdown da Bella (negrito, listas, links) e montado aqui, peca a peca;
//  - link so abre se for https;
//  - a entrada (Meetup: conta Microsoft; Sabesp: chave de acesso criada no banco) fica so
//    neste navegador (localStorage); a conversa, so nesta aba (sessionStorage);
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
const salvar = () => guardar(sessionStorage, "consulta-historico", JSON.stringify(historico.slice(-60)));

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

// Linha discreta embaixo da resposta: hora, copiar e 👍👎 (aparece ao passar o mouse; fixa na ultima)
function botoesAvaliar(m) {
  if (m.erro) return null;
  const caixa = el("div", { className: "avaliar" },
    m.em ? el("span", { className: "hora", textContent: horaDe(m.em) }) : null,
    botaoCopiar(() => textoPuro(m.texto), "Copiar a resposta", "acao", true));
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
    } catch (e) {
      for (const b of votos) b.disabled = false;
    }
  };
  caixa.append(
    el("button", { type: "button", className: "voto", title: "Ajudou", ariaLabel: "Ajudou", textContent: "👍", onclick: () => votar("like") }),
    el("button", { type: "button", className: "voto", title: "Não ajudou", ariaLabel: "Não ajudou", textContent: "👎", onclick: () => votar("dislike") }));
  return caixa;
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
    return el("div", { className: "msg da-pessoa", title: horaDe(m.em) }, el("div", { className: "balao" }, ...markdown(m.texto)));
  }
  const corpo = m.ficha ? [montarFicha(m.texto, m.ficha)] : markdown(m.texto, !m.erro);
  const extras = [];
  if (m.verMais || m.exportar) {
    extras.push(el("div", { className: "sugestoes" },
      m.verMais ? el("button", { type: "button", className: "sugestao", textContent: "Ver mais", onclick: () => enviar("ver mais") }) : null,
      m.exportar ? botaoPlanilha(m.exportar) : null));
  }
  const cartoes = Array.isArray(m.cartoes) && m.cartoes.length
    ? el("div", { className: "cartoes-sap" }, ...m.cartoes.slice(0, 3).map(cartaoSap)) : null;
  return el("div", { className: "msg da-bella" + (m.erro ? " erro" : "") }, avatar(),
    el("div", { className: "coluna" }, el("div", { className: "balao" }, ...corpo), cartoes, ...extras, botoesAvaliar(m)));
}

function adicionar(m) {
  m.em = m.em || Date.now();
  historico.push(m);
  salvar();
  if ($("app-vazia-oi")) { $("app-vazia-oi").remove(); marcarVazia(); }
  const n = desenhar(m);
  $("conversa").append(n);
  rolar();
  desenharTitulo();
  return n;
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
  "cole o texto do jeito que está no pedido, abreviado mesmo. Eu me viro.",
  "clique num número de solicitação ou num código do SAP para eu abrir os detalhes.",
  "sentiu falta de alguma coisa? Escreva “feedback” e me conte.",
  "lista grande? Peça e eu monto a planilha para abrir no Excel.",
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
  $("conversa").replaceChildren(...(historico.length ? historico.map(desenhar) : [boasVindas()]));
  marcarVazia();
  desenharTitulo();
  desenharConversas();
  desenharPerfil();
  rolar();
}

// ------------------------------------------------------------ conversas desta aba (menu lateral)
// Ficam so nesta aba (sessionStorage), como a conversa de sempre: fechou a aba, some.

let conversas = [];   // [{sessao, historico}] das conversas anteriores desta aba (a atual fica em `historico`)
try { conversas = JSON.parse(ler(sessionStorage, "consulta-conversas") || "[]"); } catch (e) { conversas = []; }
const salvarConversas = () => guardar(sessionStorage, "consulta-conversas", JSON.stringify(conversas.slice(0, 10)));

const tituloDe = (h) => {
  const p = h.find((m) => m.de === "pessoa");
  const t = p ? textoPuro(p.texto).replace(/\s+/g, " ").trim() : "";
  return t ? maiuscula(t.length > 42 ? `${t.slice(0, 40)}…` : t) : "Nova conversa";
};

// com o catalogo aberto o titulo e dele (a resposta que chega por tras nao troca)
function desenharTitulo() { $("titulo").textContent = cat.aberto ? "Procurar material" : tituloDe(historico); }

function guardarAtual() {
  if (!historico.length) return;
  conversas = [{ sessao, historico }, ...conversas.filter((c) => c.sessao !== sessao)].slice(0, 10);
  salvarConversas();
}

function desenharConversas() {
  const itens = [];
  if (historico.length) itens.push({ sessao, historico, atual: true });
  for (const c of conversas) if (c.sessao !== sessao) itens.push(c);
  $("titulo-conversas").hidden = !itens.length;
  $("lista-conversas").replaceChildren(...itens.map((c) => {
    const b = el("button", { type: "button", textContent: tituloDe(c.historico), title: tituloDe(c.historico),
      onclick: () => abrirConversa(c.sessao) });
    if (c.atual && !cat.aberto) b.setAttribute("aria-current", "true");
    return b;
  }));
}

function abrirConversa(s) {
  fecharLado();
  fecharCatalogo();
  if (s === sessao || ocupado) return;
  const c = conversas.find((x) => x.sessao === s);
  if (!c) return;
  espera++;
  guardarAtual();
  conversas = conversas.filter((x) => x.sessao !== s);
  salvarConversas();
  sessao = c.sessao;
  historico = c.historico;
  guardar(sessionStorage, "consulta-sessao", sessao);
  salvar();
  redesenhar();
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
    $(id).title = ocupado ? "Espere a resposta terminar (ou pare a resposta)" : "Começar uma conversa nova";
  }
  $("lista-conversas").classList.toggle("travada", ocupado);
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

async function enviar(texto) {
  texto = String(texto || "").trim();
  if (!texto || ocupado || !codigo) return;
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
    const d = await conversarAoVivo({ sessao, navegador, texto }, aoEvento, parada.signal);
    limpar();
    if (d.pedido) {
      aviso.hidden = false;
      await acompanhar(d, aviso);
    } else {
      aviso.remove();
      adicionar({ de: "bella", texto: d.resposta || "", mensagem: d.mensagem || null, verMais: !!d.ver_mais,
        exportar: d.exportar && typeof d.exportar === "object" ? d.exportar : null,
        cartoes: Array.isArray(d.cartoes) ? d.cartoes : null });
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
  espera++;
  guardarAtual();
  historico = [];
  salvar();
  sessao = novoId();
  guardar(sessionStorage, "consulta-sessao", sessao);
  redesenhar();
  $("mensagem").focus();
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

const cat = { aberto: false, opcoes: null, pagina: 1, bloqueio: "", pedido: null, espera: 0, ultimo: null };

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
  $("cat-tipo").append(...(cat.opcoes.tipos || []).map((t) => el("option", { value: t, textContent: t })));
  $("cat-grupos").replaceChildren(...(cat.opcoes.grupos || []).map((g) =>
    el("option", { value: `${g.codigo} · ${g.descricao || ""}`.trim() })));
  if (cat.aberto && !cat.ultimo) desenharCatalogo(null);   // agora com a data dos materiais
}

function abrirCatalogo() {
  fecharLado();
  cat.aberto = true;   // com a Bella respondendo, a resposta continua na conversa, por tras
  $("chat").classList.add("modo-catalogo");
  $("catalogo").hidden = false;
  $("atalho-material").setAttribute("aria-current", "true");
  desenharConversas();
  desenharTitulo();
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
  desenharTitulo();
  desenharConversas();
}

function buscarNoCatalogo(espera = 0) {
  clearTimeout(cat.espera);
  cat.espera = setTimeout(async () => {
    const f = filtrosDoCatalogo();
    $("cat-limpar").hidden = !(f.tipo || f.gm || f.bloqueio || f.manda_usar_outro || f.tipo_errado);
    if (!f.texto && !f.tipo && !f.gm && !f.manda_usar_outro && !f.tipo_errado && !f.bloqueio) {
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
    d.texto_planilha && d.total ? botaoPlanilha({ tipo: "sap", total: d.total, texto: d.texto_planilha }) : null);
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
  if (codigo) { redesenhar(); $("mensagem").focus(); } else if (aba === "sabesp") $("codigo").focus();
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
  telas();
}

// De quem e o codigo (o nome aparece no "Oi, Luiz!"); codigo que deixou de valer sai.
async function quemSou() {
  const d = await chamar({ quem: 1 });
  nome = typeof d.nome === "string" ? d.nome : "";
  codigoDoTime = !d.pessoal && !d.microsoft;
  guardar(localStorage, "consulta-nome", nome);
  guardar(localStorage, "consulta-time", codigoDoTime ? "1" : "");
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
  enviar(t);
});

// Enter envia; Shift+Enter quebra a linha
$("mensagem").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    if (!ocupado) $("form-chat").requestSubmit();  // Enter nunca para a resposta: so o botao
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
$("abrir-lado").addEventListener("click", abrirLado);
$("fechar-lado").addEventListener("click", fecharLado);
$("cortina").addEventListener("click", fecharLado);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharLado(); });
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
  });
}
