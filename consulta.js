// Consulta da Bella (pagina estatica): a mesma conversa do Teams, no navegador.
// Seguranca:
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
const ehSessao = (c) => /^S[0-9a-f]{64}$/.test(c);
// formas de entrar que a pagina mostra (o servidor diz; ?microsoft=1 mostra o botao para testar)
let formas = { microsoft: /[?&]microsoft=1/.test(location.search), codigo: true };
let comCodigo = false;   // com o botao Microsoft, o campo do codigo so aparece se a pessoa pedir
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
  return el("img", { className: "avatar", src: "img/favicon.png", alt: "", width: 32, height: 32 });
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
      u.texto ? document.createTextNode(` ${u.texto} `) : null, u.bloqueio ? seloBloqueio(u.bloqueio) : null) : null);
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
  $("ideias")?.remove();
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

// poucos atalhos, discretos, e so na conversa vazia (somem na primeira pergunta)
const EXEMPLOS = [
  "quantas com a CH há mais de 48 h úteis?", "já existe válvula gaveta DN 100?", "como estão as minhas?",
];

function boasVindas() {
  return el("div", { className: "msg da-bella" }, avatar(),
    el("div", { className: "coluna" },
      el("div", { className: "balao" },
        el("p", {}, nome ? `Oi, ${nome}! ` : "Oi! ", "Sou a ", el("strong", { textContent: "Bella" }),
          " 😊 Pergunte do seu jeito sobre solicitações do Webformat, materiais do SAP ou dúvidas do cadastro."),
        nome ? null : el("p", { className: "dica" }, "🔐 Você entrou com o código do time, que vai deixar de valer. " +
          "Quem é da Meetup entra com a conta Microsoft; usuários da Sabesp recebem a chave pessoal do Luiz Henrique Brambilla Teixeira.")),
      historico.length ? null : el("div", { className: "ideias", id: "ideias" }, ...EXEMPLOS.map((q) =>
        el("button", { type: "button", className: "ideia", textContent: q, onclick: () => enviar(q) })))));
}

function redesenhar() {
  $("conversa").replaceChildren(boasVindas(), ...historico.map(desenhar));
  rolar();
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
  catalogo_sap: "Procurando no catálogo do SAP…", buscar_material: "Olhando o histórico de materiais…",
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
      aviso.querySelector(".digitando-texto").textContent = rotuloConsulta(d.ferramentas);
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
  const campo = formas.codigo && (!formas.microsoft || comCodigo);
  $("entrada-ms").hidden = !!codigo || !formas.microsoft;
  $("usar-codigo").hidden = !formas.codigo || comCodigo;
  $("cartao-entrada").hidden = !!codigo;
  $("separador").hidden = $("usar-codigo").hidden;
  $("rotulo-chave").hidden = !!codigo || !campo;
  $("form-codigo").hidden = !!codigo || !campo;
  $("como-entrar").hidden = !!codigo || !campo;
  if (codigo) $("erro-codigo").hidden = true;
  $("chat").hidden = !codigo;
  if (codigo) { redesenhar(); $("mensagem").focus(); } else if (campo) $("codigo").focus();
}

// [título, texto, tom]: "espera" (amarelo) quando não é erro de quem tentou entrar
const AVISOS_DE_CODIGO = {
  invalido: ["Chave não reconhecida", "Confira a chave que o Luiz Henrique Brambilla Teixeira te passou. Quem é da Meetup entra com a conta Microsoft.", "erro"],
  expirado: ["Chave expirada", "Ela ficou 60 dias sem uso. Peça uma nova ao Luiz Henrique Brambilla Teixeira, do time de Master Data.", "espera"],
  sessao: ["Sua entrada terminou", "É só entrar de novo com a conta Microsoft.", "espera"],
  "sessao-expirada": ["Sua entrada expirou", "Ela ficou 30 dias sem uso. É só entrar de novo com a conta Microsoft.", "espera"],
  "so-microsoft": ["Use a conta Microsoft", "Quem é da Meetup entra pelo botão da Microsoft. A chave de acesso é só para usuários da Sabesp.", "espera"],
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
  "entre com a conta Microsoft": "so-microsoft",
})[erro] || "invalido";

function avisarCodigo(tipo) {
  mostrarAviso(...AVISOS_DE_CODIGO[tipo]);
  // erro da chave: deixa o campo da chave aberto
  if ((tipo === "invalido" || tipo === "expirado") && !comCodigo) { comCodigo = true; telas(); }
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
  history.replaceState(null, "", location.pathname + location.search);
  const esperado = ler(sessionStorage, "consulta-estado");
  try { sessionStorage.removeItem("consulta-estado"); } catch (e) { /* ok */ }
  const s = h.get("sessao") || "";
  if (s && ehSessao(s) && esperado && h.get("estado") === esperado) {
    codigo = s;
    guardar(localStorage, "consulta-codigo", s);
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
  try { localStorage.removeItem("consulta-codigo"); localStorage.removeItem("consulta-nome"); } catch (e) { /* ok */ }
  espera++;
  telas();
}

// De quem e o codigo (o nome aparece no "Oi, Luiz!"); codigo que deixou de valer sai.
async function quemSou() {
  const d = await chamar({ quem: 1 });
  nome = typeof d.nome === "string" ? d.nome : "";
  guardar(localStorage, "consulta-nome", nome);
}

$("form-codigo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const c = $("codigo").value.trim();
  if (!c) return;
  const botao = $("form-codigo").querySelector("button");
  botao.disabled = true;
  $("erro-codigo").hidden = true;
  codigo = c;
  try {
    await quemSou();
    guardar(localStorage, "consulta-codigo", c);
    $("codigo").value = "";
    telas();
  } catch (e) {
    codigo = "";
    if (e instanceof ErroConsulta && e.message === "código de acesso expirado") avisarCodigo("expirado");
    else if (e instanceof ErroConsulta && e.message === "código de acesso inválido") avisarCodigo("invalido");
    else if (e instanceof ErroConsulta && e.message === "entre com a conta Microsoft") avisarCodigo("so-microsoft");
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
$("sair").addEventListener("click", sairDeVez);
$("entrar-ms").addEventListener("click", entrarComMicrosoft);
$("usar-codigo").addEventListener("click", () => { comCodigo = true; telas(); });
voltaDaMicrosoft();
telas();
carregarFormas();
atualizarBotao();
// ja tinha entrado: confere o codigo e o nome (o codigo do time vale ate virar so pessoal)
if (codigo) quemSou().then(() => { if (codigo && !ocupado) redesenhar(); }, () => {});
